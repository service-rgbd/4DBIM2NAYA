from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pymongo import ReturnDocument
from core.db import db, fs, new_id, now_iso, today
from core.audit import audit, diff
from core.schemas import IssueIn, IssuePatch, IssueStatusIn, CommentIn
from core.security import get_current_user, authorize

router = APIRouter(tags=["issues"])
MAX_PHOTO = 10 * 1024 * 1024
MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png", b"RIFF": "image/webp"}
# status -> allowed next statuses ; transitions to a_verifier are open to sub-contractors (progress permission)
TRANSITIONS = {
    "ouvert": {"affecte", "en_cours"}, "affecte": {"en_cours", "ouvert"}, "en_cours": {"a_verifier"},
    "a_verifier": {"resolu", "en_cours"}, "resolu": {"cloture", "en_cours"}, "cloture": {"ouvert"},
}
PROGRESS_ONLY = {("affecte", "en_cours"), ("en_cours", "a_verifier")}
FIELDS = ["title", "description", "priority", "responsible", "company", "due_date"]


async def _issue(iid: str) -> dict:
    i = await db.issues.find_one({"id": iid, "deleted_at": None}, {"_id": 0})
    if not i:
        raise HTTPException(status_code=404, detail="Réserve introuvable")
    return i


def _with_flags(i: dict) -> dict:
    i["overdue"] = bool(i.get("due_date") and i["status"] not in ("resolu", "cloture") and i["due_date"] < today().isoformat())
    for p in i.get("photos", []):
        p.pop("file_id", None)
    return i


async def _element_context(pid: str, body: IssueIn) -> dict:
    if not body.global_id:
        return {}
    model = await db.bim_models.find_one({"id": body.model_id, "project_id": pid, "deleted_at": None})
    if not model or not model.get("current_version_id"):
        raise HTTPException(status_code=422, detail="Maquette introuvable pour l'objet BIM indiqué")
    e = await db.bim_elements.find_one({"version_id": model["current_version_id"], "global_id": body.global_id})
    if not e:
        raise HTTPException(status_code=422, detail="Objet IFC introuvable dans la version courante")
    return {"element_name": e["name"], "ifc_type": e["ifc_type"], "storey": body.storey or e["storey"]}


@router.get("/projects/{pid}/issues")
async def list_issues(pid: str, status: str = "", priority: str = "", company: str = "", global_id: str = "", user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    q = {"project_id": pid, "deleted_at": None}
    for k, v in (("status", status), ("priority", priority), ("company", company), ("global_id", global_id)):
        if v:
            q[k] = v
    items = [_with_flags(i) for i in await db.issues.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)]
    open_items = [i for i in items if i["status"] not in ("resolu", "cloture")]
    stats = {"total": len(items), "open": len(open_items), "critical_open": sum(1 for i in open_items if i["priority"] == "critique"),
             "overdue": sum(1 for i in items if i["overdue"]), "closed": sum(1 for i in items if i["status"] == "cloture")}
    companies = sorted(c for c in await db.issues.distinct("company", {"project_id": pid, "deleted_at": None}) if c)
    return {"items": items, "stats": stats, "companies": companies}


@router.post("/projects/{pid}/issues", status_code=201)
async def create_issue(pid: str, body: IssueIn, user=Depends(get_current_user)):
    await authorize(user, pid, "create")
    ctx = await _element_context(pid, body)
    counter = await db.counters.find_one_and_update({"_id": f"issue:{pid}"}, {"$inc": {"n": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    i = {"id": new_id(), "project_id": pid, "reference": f"RES-{counter['n']:04d}", **body.model_dump(mode="json"), **ctx,
         "status": "affecte" if body.responsible else "ouvert", "photos": [], "comments": [], "resolution_note": "",
         "created_by": user["email"], "created_at": now_iso(), "updated_at": now_iso(), "closed_at": None, "version": 1, "deleted_at": None}
    await db.issues.insert_one(i)
    await audit(user, pid, "issue.create", "issue", i["id"], f"Réserve {i['reference']} créée : {i['title']}" + (f" (objet {i['global_id']})" if i.get("global_id") else ""))
    i.pop("_id", None)
    return _with_flags(i)


@router.get("/issues/{iid}")
async def get_issue(iid: str, user=Depends(get_current_user)):
    i = await _issue(iid)
    await authorize(user, i["project_id"], "read")
    i["history"] = await db.audit_logs.find({"entity_id": iid}, {"_id": 0}).sort("at", -1).to_list(200)
    return _with_flags(i)


@router.patch("/issues/{iid}")
async def update_issue(iid: str, body: IssuePatch, user=Depends(get_current_user)):
    i = await _issue(iid)
    await authorize(user, i["project_id"], "update")
    upd = body.model_dump(mode="json", exclude_unset=True, exclude={"version"})
    r = await db.issues.update_one({"id": iid, "version": body.version}, {"$set": {**upd, "updated_at": now_iso()}, "$inc": {"version": 1}})
    if not r.modified_count:
        raise HTTPException(status_code=409, detail="Conflit : la réserve a été modifiée entre-temps. Rechargez.")
    before, after = diff(i, upd, FIELDS)
    if after:
        await audit(user, i["project_id"], "issue.update", "issue", iid, f"Modification de {i['reference']}", before, after)
    return await get_issue(iid, user)


def _check_transition(i: dict, body: IssueStatusIn):
    if body.status not in TRANSITIONS[i["status"]]:
        raise HTTPException(status_code=400, detail=f"Transition interdite : {i['status']} → {body.status}")
    if body.status == "affecte" and not i.get("responsible"):
        raise HTTPException(status_code=422, detail="Affectation impossible : renseignez d'abord un responsable")
    if body.status == "a_verifier" and not (body.note.strip() or i.get("photos")):
        raise HTTPException(status_code=422, detail="Ajoutez une note ou une photo de preuve avant de demander la vérification")
    if body.status == "cloture" and not (i.get("resolution_note") or body.note.strip()):
        raise HTTPException(status_code=422, detail="Clôture refusée : aucune preuve de résolution enregistrée")


@router.post("/issues/{iid}/status")
async def change_status(iid: str, body: IssueStatusIn, user=Depends(get_current_user)):
    i = await _issue(iid)
    action = "progress" if (i["status"], body.status) in PROGRESS_ONLY else "update"
    await authorize(user, i["project_id"], action)
    if body.version != i["version"]:
        raise HTTPException(status_code=409, detail="Conflit : la réserve a été modifiée entre-temps. Rechargez.")
    _check_transition(i, body)
    upd = {"status": body.status, "updated_at": now_iso(), "closed_at": now_iso() if body.status == "cloture" else None}
    if body.status in ("a_verifier", "resolu") and body.note.strip():
        upd["resolution_note"] = body.note.strip()
    await db.issues.update_one({"id": iid}, {"$set": upd, "$inc": {"version": 1}})
    await audit(user, i["project_id"], "issue.status", "issue", iid, f"{i['reference']} : {i['status']} → {body.status}. {body.note}".strip(),
                {"status": i["status"]}, {"status": body.status})
    return await get_issue(iid, user)


@router.post("/issues/{iid}/comments", status_code=201)
async def add_comment(iid: str, body: CommentIn, user=Depends(get_current_user)):
    i = await _issue(iid)
    await authorize(user, i["project_id"], "progress" if user["role"] != "admin_plateforme" else "read")
    c = {"id": new_id(), "text": body.text, "by": user["email"], "at": now_iso()}
    await db.issues.update_one({"id": iid}, {"$push": {"comments": c}, "$set": {"updated_at": now_iso()}, "$inc": {"version": 1}})
    await audit(user, i["project_id"], "issue.comment", "issue", iid, f"Commentaire sur {i['reference']}")
    return c


@router.post("/issues/{iid}/photos", status_code=201)
async def add_photo(iid: str, file: UploadFile = File(...), kind: str = Form("constat"), user=Depends(get_current_user)):
    i = await _issue(iid)
    await authorize(user, i["project_id"], "progress" if kind == "preuve" else "create")
    raw = await file.read(MAX_PHOTO + 1)
    if len(raw) > MAX_PHOTO:
        raise HTTPException(status_code=413, detail="Photo trop volumineuse (10 Mo max.)")
    ctype = next((t for m, t in MAGIC.items() if raw.startswith(m)), None)
    if not ctype or (ctype == "image/webp" and raw[8:12] != b"WEBP"):
        raise HTTPException(status_code=422, detail="Format non pris en charge (JPEG, PNG ou WebP uniquement)")
    file_id = await fs.upload_from_stream(file.filename or "photo", raw, metadata={"project_id": i["project_id"], "content_type": ctype})
    p = {"id": new_id(), "file_id": file_id, "content_type": ctype, "kind": "preuve" if kind == "preuve" else "constat",
         "filename": file.filename, "by": user["email"], "at": now_iso()}
    await db.issues.update_one({"id": iid}, {"$push": {"photos": p}, "$set": {"updated_at": now_iso()}, "$inc": {"version": 1}})
    await audit(user, i["project_id"], "issue.photo", "issue", iid, f"Photo ({p['kind']}) ajoutée à {i['reference']}")
    return {k: v for k, v in p.items() if k != "file_id"}


@router.get("/issues/{iid}/photos/{photo_id}")
async def get_photo(iid: str, photo_id: str, user=Depends(get_current_user)):
    i = await db.issues.find_one({"id": iid, "deleted_at": None})
    if not i:
        raise HTTPException(status_code=404, detail="Réserve introuvable")
    await authorize(user, i["project_id"], "read")
    p = next((p for p in i.get("photos", []) if p["id"] == photo_id), None)
    if not p:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    stream = await fs.open_download_stream(p["file_id"])
    return StreamingResponse(iter([await stream.read()]), media_type=p["content_type"])
