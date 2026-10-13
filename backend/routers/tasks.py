from fastapi import APIRouter, Depends, HTTPException
from core.db import db, new_id, now_iso, today, clean
from core.audit import audit, diff
from core.schemas import TaskIn, TaskPatch, MoveIn, ProgressIn, DependencyIn, BaselineIn
from core.security import get_current_user, authorize
from services.planning import recompute, load_graph, simulate, with_health
from services.scheduling import topo_order, CycleError

router = APIRouter(tags=["planning"])
FIELDS = ["name", "code", "description", "lot", "zone", "company", "responsible", "start", "duration", "is_milestone", "priority", "status"]
SCHEDULE_FIELDS = {"start", "duration", "is_milestone"}


async def _task(tid):
    t = await db.tasks.find_one({"id": tid, "deleted_at": None}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Activité introuvable")
    return t


@router.get("/projects/{pid}/tasks")
async def list_tasks(pid: str, user=Depends(get_current_user)):
    p = await authorize(user, pid, "read")
    tasks, deps = await load_graph(pid)
    counts = {}
    async for row in db.links.aggregate([{"$match": {"project_id": pid}}, {"$group": {"_id": "$task_id", "n": {"$sum": 1}}}]):
        counts[row["_id"]] = row["n"]
    now = today()
    for t in tasks:
        with_health(t, now)
        t["link_count"] = counts.get(t["id"], 0)
    return {"tasks": tasks, "dependencies": deps, "today": now.isoformat(), "computed_finish": p.get("computed_finish"), "calendar": p.get("calendar")}


@router.post("/projects/{pid}/tasks", status_code=201)
async def create_task(pid: str, body: TaskIn, user=Depends(get_current_user)):
    await authorize(user, pid, "create")
    last = await db.tasks.find_one({"project_id": pid}, sort=[("sort_order", -1)])
    order = (last or {}).get("sort_order", 0) + 1
    data = body.model_dump(mode="json")
    if data["is_milestone"]:
        data["duration"] = 0
    t = {"id": new_id(), "project_id": pid, **data, "code": data.get("code") or f"A{order:03d}", "sort_order": order,
         "progress": 0, "actual_start": None, "actual_end": None, "version": 1, "created_by": user["email"],
         "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None}
    await db.tasks.insert_one(t)
    await recompute(pid)
    await audit(user, pid, "task.create", "task", t["id"], f"Création de l'activité {t['code']} {t['name']}", after=data)
    return with_health(await _task(t["id"]))


@router.post("/tasks/{tid}/preview-move")
async def preview_move(tid: str, body: MoveIn, user=Depends(get_current_user)):
    t = await _task(tid)
    p = await authorize(user, t["project_id"], "update")
    tasks, deps = await load_graph(t["project_id"])
    ov = {"start": body.start.isoformat()}
    if body.duration is not None:
        ov["duration"] = body.duration
    res, finish = simulate(tasks, deps, p.get("calendar"), {tid: ov})
    me = res[tid]
    names = {x["id"]: f"{x['code']} {x['name']}" for x in tasks}
    blocked = me["early_start"] > body.start.isoformat() and bool(me["driven_by"])
    impacted = [{"id": x["id"], "label": names[x["id"]], "old_start": x.get("early_start"), "new_start": res[x["id"]]["early_start"],
                 "old_finish": x.get("early_finish"), "new_finish": res[x["id"]]["early_finish"]}
                for x in tasks if x["id"] != tid and (x.get("early_start"), x.get("early_finish")) != (res[x["id"]]["early_start"], res[x["id"]]["early_finish"])]
    return {"requested_start": body.start.isoformat(), "effective_start": me["early_start"], "effective_finish": me["early_finish"],
            "blocked_by": [names[i] for i in me["driven_by"]] if blocked else [], "impacted": impacted,
            "project_finish_before": p.get("computed_finish"), "project_finish_after": finish}


@router.patch("/tasks/{tid}")
async def update_task(tid: str, body: TaskPatch, user=Depends(get_current_user)):
    t = await _task(tid)
    await authorize(user, t["project_id"], "update")
    if body.version != t["version"]:
        raise HTTPException(status_code=409, detail=f"Conflit : l'activité a été modifiée par {t.get('updated_by', 'un autre utilisateur')} ({t['updated_at'][:16].replace('T', ' ')}). Rechargez le planning.")
    upd = body.model_dump(mode="json", exclude_unset=True, exclude={"version", "exception_reason"})
    if upd.get("is_milestone"):
        upd["duration"] = 0
    exception = None
    if upd.get("status") == "termine" and t["status"] != "termine":
        if t.get("progress", 0) < 100:
            if not body.exception_reason:
                raise HTTPException(status_code=422, detail="Clôture refusée : avancement < 100 %. Saisissez l'avancement ou une justification d'exception.")
            exception = body.exception_reason
        upd.setdefault("actual_end", today().isoformat())
    before, after = diff(t, upd, FIELDS + ["actual_end"])
    r = await db.tasks.update_one({"id": tid, "version": body.version},
                                  {"$set": {**upd, "updated_at": now_iso(), "updated_by": user["email"]}, "$inc": {"version": 1}})
    if not r.modified_count:
        raise HTTPException(status_code=409, detail="Conflit de modification, rechargez le planning.")
    if SCHEDULE_FIELDS & set(after):
        await recompute(t["project_id"])
    if after:
        summary = f"Modification de {t['code']} {t['name']}" + (f" — clôture par exception : {exception}" if exception else "")
        await audit(user, t["project_id"], "task.close_exception" if exception else "task.update", "task", tid, summary, before, after)
    return with_health(await _task(tid))


@router.post("/tasks/{tid}/duplicate", status_code=201)
async def duplicate_task(tid: str, user=Depends(get_current_user)):
    t = await _task(tid)
    body = TaskIn(**{k: t[k] for k in ["name", "description", "lot", "zone", "company", "responsible", "start", "duration", "is_milestone", "priority"]})
    body.name = (t["name"] + " (copie)")[:200]
    return await create_task(t["project_id"], body, user)


@router.delete("/tasks/{tid}")
async def delete_task(tid: str, user=Depends(get_current_user)):
    t = await _task(tid)
    await authorize(user, t["project_id"], "delete")
    links = await db.links.count_documents({"task_id": tid})
    await db.tasks.update_one({"id": tid}, {"$set": {"deleted_at": now_iso(), "updated_by": user["email"]}})
    await db.dependencies.delete_many({"$or": [{"predecessor_id": tid}, {"successor_id": tid}]})
    await db.links.delete_many({"task_id": tid})
    await recompute(t["project_id"])
    await audit(user, t["project_id"], "task.delete", "task", tid, f"Suppression logique de {t['code']} {t['name']} ({links} liaison(s) BIM retirée(s))", before={"name": t["name"]})
    return {"ok": True}


@router.post("/tasks/{tid}/progress", status_code=201)
async def record_progress(tid: str, body: ProgressIn, user=Depends(get_current_user)):
    t = await _task(tid)
    await authorize(user, t["project_id"], "progress")
    if body.date > today():
        raise HTTPException(status_code=422, detail="La date d'avancement ne peut pas être future")
    if t["status"] in ("annule",):
        raise HTTPException(status_code=409, detail="Activité annulée")
    d = body.date.isoformat()
    upd = {"progress": body.progress, "updated_at": now_iso(), "updated_by": user["email"]}
    if body.progress > 0 and not t.get("actual_start"):
        upd["actual_start"] = d
    if body.progress == 100:
        upd["actual_end"], upd["status"] = d, "termine"
    elif body.progress > 0:
        upd["actual_end"] = None
        if t["status"] in ("a_planifier", "a_faire", "termine"):
            upd["status"] = "en_cours"
    rec = {"id": new_id(), "project_id": t["project_id"], "task_id": tid, "progress": body.progress, "date": d,
           "comment": body.comment, "method": "pourcentage_saisi", "by": user["email"], "created_at": now_iso()}
    await db.progress_records.insert_one(rec)
    await db.tasks.update_one({"id": tid}, {"$set": upd, "$inc": {"version": 1}})
    await audit(user, t["project_id"], "task.progress", "task", tid, f"Avancement {t['code']} : {t.get('progress', 0)} % → {body.progress} % au {d}",
                {"progress": t.get("progress", 0)}, {"progress": body.progress})
    return with_health(await _task(tid))


@router.get("/tasks/{tid}/progress")
async def list_progress(tid: str, user=Depends(get_current_user)):
    t = await _task(tid)
    await authorize(user, t["project_id"], "read")
    return await db.progress_records.find({"task_id": tid}, {"_id": 0}).sort("date", -1).to_list(500)


@router.get("/tasks/{tid}/history")
async def task_history(tid: str, user=Depends(get_current_user)):
    t = await _task(tid)
    await authorize(user, t["project_id"], "read")
    return await db.audit_logs.find({"entity_id": tid}, {"_id": 0}).sort("at", -1).to_list(200)


@router.post("/projects/{pid}/dependencies", status_code=201)
async def create_dependency(pid: str, body: DependencyIn, user=Depends(get_current_user)):
    await authorize(user, pid, "update")
    if body.predecessor_id == body.successor_id:
        raise HTTPException(status_code=422, detail="Une activité ne peut pas dépendre d'elle-même")
    tasks, deps = await load_graph(pid)
    ids = {t["id"]: t for t in tasks}
    if body.predecessor_id not in ids or body.successor_id not in ids:
        raise HTTPException(status_code=404, detail="Activité introuvable dans ce projet")
    if any(d["predecessor_id"] == body.predecessor_id and d["successor_id"] == body.successor_id for d in deps):
        raise HTTPException(status_code=409, detail="Cette dépendance existe déjà")
    d = {"id": new_id(), "project_id": pid, **body.model_dump(), "created_by": user["email"], "created_at": now_iso()}
    try:
        topo_order(list(ids), deps + [d])
    except CycleError:
        a, b = ids[body.predecessor_id], ids[body.successor_id]
        raise HTTPException(status_code=400, detail=f"Dépendance circulaire : {b['code']} précède déjà (directement ou non) {a['code']}. Liaison refusée.")
    await db.dependencies.insert_one(d)
    await recompute(pid)
    await audit(user, pid, "dependency.create", "dependency", d["id"],
                f"Dépendance {ids[body.predecessor_id]['code']} → {ids[body.successor_id]['code']} ({body.type}, décalage {body.lag} j)", after=body.model_dump())
    return clean(d)


@router.delete("/dependencies/{did}")
async def delete_dependency(did: str, user=Depends(get_current_user)):
    d = await db.dependencies.find_one({"id": did})
    if not d:
        raise HTTPException(status_code=404, detail="Dépendance introuvable")
    await authorize(user, d["project_id"], "update")
    await db.dependencies.delete_one({"id": did})
    await recompute(d["project_id"])
    await audit(user, d["project_id"], "dependency.delete", "dependency", did, f"Suppression de dépendance ({d['type']})", before=clean(d))
    return {"ok": True}


@router.get("/projects/{pid}/baselines")
async def list_baselines(pid: str, user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    return await db.baselines.find({"project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("/projects/{pid}/baselines", status_code=201)
async def create_baseline(pid: str, body: BaselineIn, user=Depends(get_current_user)):
    await authorize(user, pid, "publish")
    tasks, _ = await load_graph(pid)
    b = {"id": new_id(), "project_id": pid, "name": body.name, "created_by": user["email"], "created_at": now_iso(),
         "tasks": [{"task_id": t["id"], "start": t.get("early_start"), "finish": t.get("early_finish")} for t in tasks]}
    await db.baselines.insert_one(b)
    await audit(user, pid, "baseline.create", "baseline", b["id"], f"Planning de référence « {body.name} » enregistré ({len(tasks)} activités)")
    return clean(b)
