import hashlib
import os
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from core.db import db, fs, new_id, now_iso, clean
from core.audit import audit
from core.schemas import LinkIn, RuleIn, RulePreviewIn
from core.security import get_current_user, authorize
from services.linking import rule_query, current_version, create_links, apply_rule

router = APIRouter(tags=["bim"])
MAX_MB = int(os.environ.get("BIM_MAX_UPLOAD_MB", "200"))
LIGHT = {"_id": 0, "express_id": 1, "global_id": 1, "ifc_type": 1, "name": 1, "storey": 1, "discipline": 1}


async def _version(vid, user, action="read"):
    v = await db.bim_versions.find_one({"id": vid}, {"_id": 0, "spatial": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Version de maquette introuvable")
    await authorize(user, v["project_id"], action)
    return v


@router.get("/projects/{pid}/models")
async def list_models(pid: str, user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    models = await db.bim_models.find({"project_id": pid, "deleted_at": None}, {"_id": 0}).sort("created_at", 1).to_list(200)
    for m in models:
        m["versions"] = await db.bim_versions.find({"model_id": m["id"]}, {"_id": 0, "spatial": 0, "file_id": 0}).sort("version_no", -1).to_list(100)
        m["link_count"] = await db.links.count_documents({"model_id": m["id"]})
    return models


@router.post("/projects/{pid}/models", status_code=201)
async def upload_model(pid: str, file: UploadFile = File(...), name: str = Form(""), discipline: str = Form("Architecture"),
                       model_id: str = Form(""), user=Depends(get_current_user)):
    await authorize(user, pid, "create")
    if not (file.filename or "").lower().endswith(".ifc"):
        raise HTTPException(status_code=422, detail="Seuls les fichiers .ifc (STEP) sont acceptés pour le traitement BIM")
    raw = await file.read(MAX_MB * 1024 * 1024 + 1)
    if len(raw) > MAX_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Fichier trop volumineux (max {MAX_MB} Mo)")
    if not raw[:64].lstrip().startswith(b"ISO-10303-21"):
        raise HTTPException(status_code=422, detail="Contenu invalide : en-tête ISO-10303-21 absent (fichier IFC-XML/IFCZIP non pris en charge)")
    sha = hashlib.sha256(raw).hexdigest()
    if model_id:
        model = await db.bim_models.find_one({"id": model_id, "project_id": pid, "deleted_at": None})
        if not model:
            raise HTTPException(status_code=404, detail="Maquette introuvable")
        if await db.bim_versions.find_one({"model_id": model_id, "sha256": sha}):
            raise HTTPException(status_code=409, detail="Ce fichier (même empreinte SHA-256) existe déjà pour cette maquette")
    else:
        model = {"id": new_id(), "project_id": pid, "name": (name or file.filename)[:160], "discipline": discipline[:60],
                 "current_version_id": None, "created_by": user["email"], "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None}
        await db.bim_models.insert_one(model)
    last = await db.bim_versions.find_one({"model_id": model["id"]}, sort=[("version_no", -1)])
    file_id = await fs.upload_from_stream(file.filename, raw, metadata={"project_id": pid, "sha256": sha, "content_type": "application/x-step"})
    v = {"id": new_id(), "project_id": pid, "model_id": model["id"], "version_no": (last or {}).get("version_no", 0) + 1,
         "filename": file.filename, "size": len(raw), "sha256": sha, "file_id": file_id, "status": "en_attente", "progress": 0,
         "stage": "En file d'attente", "attempts": 0, "error": None, "uploaded_by": user["email"], "created_at": now_iso()}
    await db.bim_versions.insert_one(v)
    await audit(user, pid, "bim.upload", "bim_version", v["id"], f"Import IFC {file.filename} (v{v['version_no']}, {len(raw) // 1024} Ko, sha256 {sha[:12]}…)")
    v.pop("_id", None)
    v["file_id"] = str(file_id)
    return {"model": clean(model), "version": v}


@router.post("/model-versions/{vid}/retry")
async def retry(vid: str, user=Depends(get_current_user)):
    v = await _version(vid, user, "update")
    if v["status"] != "echec":
        raise HTTPException(status_code=409, detail="Seul un traitement en échec peut être relancé")
    await db.bim_versions.update_one({"id": vid}, {"$set": {"status": "en_attente", "attempts": 0, "stage": "Relance manuelle", "error": None}})
    await audit(user, v["project_id"], "bim.retry", "bim_version", vid, "Relance manuelle du traitement IFC")
    return {"ok": True}


@router.get("/model-versions/{vid}")
async def get_version(vid: str, user=Depends(get_current_user)):
    v = await _version(vid, user)
    v["file_id"] = str(v["file_id"])
    return v


@router.get("/model-versions/{vid}/file")
async def download(vid: str, user=Depends(get_current_user)):
    v = await _version(vid, user)
    stream = await fs.open_download_stream(v["file_id"])

    async def gen():
        while True:
            chunk = await stream.readchunk()
            if not chunk:
                break
            yield chunk
    return StreamingResponse(gen(), media_type="application/octet-stream",
                             headers={"Content-Disposition": f'attachment; filename="{v["filename"]}"', "Content-Length": str(v["size"]), "X-Content-SHA256": v["sha256"]})


@router.get("/model-versions/{vid}/elements")
async def elements(vid: str, user=Depends(get_current_user)):
    await _version(vid, user)
    return await db.bim_elements.find({"version_id": vid}, LIGHT).to_list(200000)


@router.get("/model-versions/{vid}/elements/{gid}")
async def element(vid: str, gid: str, user=Depends(get_current_user)):
    v = await _version(vid, user)
    e = await db.bim_elements.find_one({"version_id": vid, "global_id": gid}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Objet IFC introuvable")
    task_ids = [lk["task_id"] async for lk in db.links.find({"model_id": v["model_id"], "global_id": gid})]
    e["issues"] = await db.issues.find({"project_id": v["project_id"], "global_id": gid, "deleted_at": None}, {"_id": 0, "id": 1, "reference": 1, "title": 1, "status": 1, "priority": 1}).to_list(100)
    e["tasks"] = await db.tasks.find({"id": {"$in": task_ids}, "deleted_at": None}, {"_id": 0, "id": 1, "code": 1, "name": 1, "early_start": 1, "early_finish": 1, "status": 1}).to_list(100)
    return e


@router.get("/model-versions/{vid}/facets")
async def facets(vid: str, user=Depends(get_current_user)):
    await _version(vid, user)
    async def agg(field):
        return [{"value": r["_id"], "count": r["n"]} async for r in db.bim_elements.aggregate([{"$match": {"version_id": vid}}, {"$group": {"_id": f"${field}", "n": {"$sum": 1}}}, {"$sort": {"_id": 1}}])]
    props = [{"value": r["_id"], "count": r["n"]} async for r in db.bim_elements.aggregate([
        {"$match": {"version_id": vid}}, {"$unwind": "$properties"}, {"$group": {"_id": "$properties.name", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 150}])]
    return {"ifc_types": await agg("ifc_type"), "storeys": await agg("storey"), "disciplines": await agg("discipline"), "properties": props}


@router.get("/projects/{pid}/links")
async def list_links(pid: str, model_id: str = "", user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    q = {"project_id": pid}
    if model_id:
        q["model_id"] = model_id
    return await db.links.find(q, {"_id": 0, "id": 1, "task_id": 1, "model_id": 1, "global_id": 1, "rule_id": 1}).to_list(500000)


async def _check_task(pid, tid):
    if not await db.tasks.find_one({"id": tid, "project_id": pid, "deleted_at": None}):
        raise HTTPException(status_code=404, detail="Activité introuvable dans ce projet")


@router.post("/projects/{pid}/links", status_code=201)
async def add_links(pid: str, body: LinkIn, user=Depends(get_current_user)):
    await authorize(user, pid, "link")
    await _check_task(pid, body.task_id)
    _, vid = await current_version(body.model_id, pid)
    valid = await db.bim_elements.distinct("global_id", {"version_id": vid, "global_id": {"$in": body.global_ids}})
    if not valid:
        raise HTTPException(status_code=422, detail="Aucun identifiant IFC valide pour la version courante")
    created = await create_links(user, pid, body.task_id, body.model_id, valid)
    t = await db.tasks.find_one({"id": body.task_id})
    await audit(user, pid, "link.create", "task", body.task_id, f"{created} objet(s) IFC lié(s) à {t['code']} {t['name']}", after={"global_ids": valid[:50]})
    return {"created": created, "already_linked": len(valid) - created, "rejected": len(body.global_ids) - len(valid)}


@router.post("/projects/{pid}/links/remove")
async def remove_links(pid: str, body: LinkIn, user=Depends(get_current_user)):
    await authorize(user, pid, "link")
    r = await db.links.delete_many({"project_id": pid, "task_id": body.task_id, "model_id": body.model_id, "global_id": {"$in": body.global_ids}})
    t = await db.tasks.find_one({"id": body.task_id}) or {"code": "?", "name": ""}
    await audit(user, pid, "link.delete", "task", body.task_id, f"{r.deleted_count} liaison(s) retirée(s) de {t['code']} {t['name']}", before={"global_ids": body.global_ids[:50]})
    return {"removed": r.deleted_count}


@router.post("/projects/{pid}/link-rules/preview")
async def preview_rule(pid: str, body: RulePreviewIn, user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    _, vid = await current_version(body.model_id, pid)
    q = rule_query(vid, body.filters.model_dump())
    count = await db.bim_elements.count_documents(q)
    items = await db.bim_elements.find(q, LIGHT).to_list(20000)
    linked = set(await db.links.distinct("global_id", {"model_id": body.model_id}))
    return {"count": count, "global_ids": [i["global_id"] for i in items], "sample": items[:30],
            "already_linked": sum(1 for i in items if i["global_id"] in linked)}


@router.get("/projects/{pid}/link-rules")
async def list_rules(pid: str, user=Depends(get_current_user)):
    await authorize(user, pid, "read")
    return await db.link_rules.find({"project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/projects/{pid}/link-rules", status_code=201)
async def create_rule(pid: str, body: RuleIn, user=Depends(get_current_user)):
    await authorize(user, pid, "link")
    await _check_task(pid, body.task_id)
    rule, created = await apply_rule(user, pid, body.task_id, body.model_id, body.name, body.filters.model_dump())
    return {"rule": rule, "created": created}


@router.delete("/link-rules/{rid}")
async def delete_rule(rid: str, remove_links: bool = False, user=Depends(get_current_user)):
    r = await db.link_rules.find_one({"id": rid})
    if not r:
        raise HTTPException(status_code=404, detail="Règle introuvable")
    await authorize(user, r["project_id"], "link")
    removed = (await db.links.delete_many({"rule_id": rid})).deleted_count if remove_links else 0
    await db.link_rules.delete_one({"id": rid})
    await audit(user, r["project_id"], "link.rule_delete", "link_rule", rid, f"Suppression de la règle « {r['name']} » ({removed} liaison(s) retirée(s))")
    return {"removed": removed}
