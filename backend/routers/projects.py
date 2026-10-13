from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError
from core.db import db, new_id, now_iso, today, clean
from core.audit import audit, diff
from core.schemas import ProjectIn, ProjectPatch, StatusChangeIn, CalendarIn
from core.security import get_current_user, authorize, project_role, ROLE_LABELS
from services.planning import recompute, kpis, s_curve, with_health

router = APIRouter(tags=["projects"])

TRANSITIONS = {
    "preparation": {"actif", "suspendu", "archive"},
    "actif": {"suspendu", "en_retard", "en_reception"},
    "en_retard": {"actif", "suspendu", "en_reception"},
    "suspendu": {"actif", "archive"},
    "en_reception": {"livre", "actif"},
    "livre": {"archive"},
    "archive": {"livre"},
}
DEFAULT_CALENDAR = {"working_days": [0, 1, 2, 3, 4], "exceptions": []}
EDITABLE = ["name", "description", "operation_type", "address", "client", "architect", "start_planned", "end_planned"]


async def _summary(p, user):
    tasks = await db.tasks.find({"project_id": p["id"], "deleted_at": None}, {"_id": 0}).to_list(5000)
    k, _ = kpis(tasks, [], p.get("calendar"), today())
    p["kpis"] = k
    p["model_count"] = await db.bim_models.count_documents({"project_id": p["id"], "deleted_at": None})
    p["link_count"] = await db.links.count_documents({"project_id": p["id"]})
    p["my_role"] = await project_role(user, p["id"])
    return p


@router.get("/projects")
async def list_projects(user=Depends(get_current_user)):
    q = {"deleted_at": None}
    if user["role"] != "admin_plateforme":
        ids = [m["project_id"] async for m in db.project_members.find({"user_id": user["id"]})]
        q["id"] = {"$in": ids}
    projects = await db.projects.find(q, {"_id": 0, "pending_seed_rules": 0}).sort("created_at", -1).to_list(500)
    return [await _summary(p, user) for p in projects]


@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn, user=Depends(get_current_user)):
    if body.end_planned and body.end_planned < body.start_planned:
        raise HTTPException(status_code=422, detail="La date de fin prévue doit être postérieure au début")
    data = body.model_dump(mode="json")
    p = {"id": new_id(), **data, "status": "preparation", "is_demo": False, "calendar": DEFAULT_CALENDAR,
         "manager": user["name"], "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso(),
         "deleted_at": None, "version": 1}
    try:
        await db.projects.insert_one(p)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Cette référence de projet existe déjà")
    await db.project_members.insert_one({"id": new_id(), "project_id": p["id"], "user_id": user["id"], "role": "chef_projet", "created_at": now_iso()})
    await audit(user, p["id"], "project.create", "project", p["id"], f"Création du projet {p['reference']}")
    return clean(p)


@router.get("/projects/{pid}")
async def get_project(pid: str, user=Depends(get_current_user)):
    p = await authorize(user, pid, "read")
    p.pop("pending_seed_rules", None)
    p["my_role"] = await project_role(user, pid)
    p["allowed_transitions"] = sorted(TRANSITIONS.get(p["status"], set()))
    return p


@router.patch("/projects/{pid}")
async def update_project(pid: str, body: ProjectPatch, user=Depends(get_current_user)):
    p = await authorize(user, pid, "update")
    if body.version != p["version"]:
        raise HTTPException(status_code=409, detail="Conflit : le projet a été modifié entre-temps. Rechargez avant d'enregistrer.")
    upd = body.model_dump(mode="json", exclude_unset=True, exclude={"version"})
    before, after = diff(p, upd, EDITABLE)
    r = await db.projects.update_one({"id": pid, "version": body.version}, {"$set": {**upd, "updated_at": now_iso()}, "$inc": {"version": 1}})
    if not r.modified_count:
        raise HTTPException(status_code=409, detail="Conflit de modification")
    if after:
        await audit(user, pid, "project.update", "project", pid, "Modification du projet", before, after)
    return await get_project(pid, user)


@router.post("/projects/{pid}/status")
async def change_status(pid: str, body: StatusChangeIn, user=Depends(get_current_user)):
    p = await authorize(user, pid, "admin" if body.status == "archive" else "update")
    if p["status"] == "archive" and user["role"] != "admin_plateforme":
        raise HTTPException(status_code=409, detail="Seul un administrateur peut sortir un projet de l'archive")
    if body.status not in TRANSITIONS.get(p["status"], set()):
        raise HTTPException(status_code=400, detail=f"Transition interdite : {p['status']} → {body.status}")
    await db.projects.update_one({"id": pid}, {"$set": {"status": body.status, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await audit(user, pid, "project.status", "project", pid, f"Statut : {p['status']} → {body.status}. {body.reason}".strip(), {"status": p["status"]}, {"status": body.status})
    return await get_project(pid, user)


@router.put("/projects/{pid}/calendar")
async def update_calendar(pid: str, body: CalendarIn, user=Depends(get_current_user)):
    p = await authorize(user, pid, "update")
    cal = body.model_dump(mode="json")
    await db.projects.update_one({"id": pid}, {"$set": {"calendar": cal, "updated_at": now_iso()}})
    await recompute(pid)
    await audit(user, pid, "calendar.update", "project", pid, f"Calendrier mis à jour ({len(cal['exceptions'])} exception(s))", {"calendar": p.get("calendar")}, {"calendar": cal})
    return cal


@router.get("/projects/{pid}/dashboard")
async def dashboard(pid: str, user=Depends(get_current_user)):
    p = await authorize(user, pid, "read")
    tasks = await db.tasks.find({"project_id": pid, "deleted_at": None}, {"_id": 0}).sort("sort_order", 1).to_list(5000)
    records = await db.progress_records.find({"project_id": pid}, {"_id": 0}).to_list(50000)
    now = today()
    k, cal = kpis(tasks, records, p.get("calendar"), now)
    curve = []
    starts = [t["early_start"] for t in tasks if t.get("early_start")]
    if starts:
        curve = s_curve(tasks, records, cal, date.fromisoformat(min(starts)), date.fromisoformat(p.get("computed_finish") or max(starts)))
    for t in tasks:
        with_health(t, now)
    linked = set(await db.links.distinct("task_id", {"project_id": pid}))
    milestones = [t for t in tasks if t.get("is_milestone")]
    upcoming = sorted([t for t in tasks if t["health"] not in ("termine", "annule") and t["early_finish"] >= now.isoformat()], key=lambda t: t["early_finish"])[:6]
    return {
        "today": now.isoformat(), "kpis": k, "s_curve": curve, "computed_finish": p.get("computed_finish"),
        "delayed": [t for t in tasks if t["health"] == "en_retard"][:20],
        "blocked": [t for t in tasks if t["health"] == "bloque"],
        "milestones": milestones, "upcoming": upcoming,
        "bim": {
            "models": await db.bim_models.count_documents({"project_id": pid, "deleted_at": None}),
            "links": await db.links.count_documents({"project_id": pid}),
            "tasks_linked": len(linked), "tasks_unlinked": len([t for t in tasks if t["id"] not in linked and not t.get("is_milestone")]),
        },
    }


@router.get("/projects/{pid}/members")
async def members(pid: str, user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    out = []
    async for m in db.project_members.find({"project_id": pid}, {"_id": 0}):
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "password_hash": 0})
        if u:
            out.append({**m, "user": u, "role_label": ROLE_LABELS.get(m["role"], m["role"])})
    return out


@router.get("/projects/{pid}/audit")
async def audit_log(pid: str, page: int = 1, entity: str = "", user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    q = {"project_id": pid}
    if entity:
        q["entity"] = entity
    page = max(page, 1)
    total = await db.audit_logs.count_documents(q)
    items = await db.audit_logs.find(q, {"_id": 0}).sort("at", -1).skip((page - 1) * 50).limit(50).to_list(50)
    return {"total": total, "page": page, "page_size": 50, "items": items}
