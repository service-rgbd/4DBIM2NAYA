"""Persistent IFC processing queue (MongoDB-backed): survives restarts, limited retries, explicit failures."""
import asyncio
import logging
import os
from functools import partial
from pymongo import ReturnDocument
from core.db import db, fs, new_id, now_iso
from core.audit import audit
from services.ifc_parser import parse_ifc

logger = logging.getLogger("bim_worker")
MAX_ATTEMPTS = int(os.environ.get("BIM_MAX_ATTEMPTS", "3"))


async def resume_interrupted():
    r = await db.bim_versions.update_many({"status": "traitement"}, {"$set": {"status": "en_attente", "stage": "Reprise après interruption"}})
    if r.modified_count:
        logger.info("Reprise de %s traitement(s) IFC interrompu(s)", r.modified_count)


async def _run_parse(raw, vid):
    state = {"p": 5}
    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(None, partial(parse_ifc, raw, lambda p: state.__setitem__("p", p)))
    while not fut.done():
        await asyncio.sleep(0.5)
        await db.bim_versions.update_one({"id": vid}, {"$set": {"progress": state["p"], "stage": "Extraction des entités et propriétés"}})
    return await fut


async def process(job):
    vid = job["id"]
    try:
        stream = await fs.open_download_stream(job["file_id"])
        raw = await stream.read()
        result = await _run_parse(raw, vid)
        await db.bim_elements.delete_many({"version_id": vid})
        docs = [{"id": new_id(), "project_id": job["project_id"], "model_id": job["model_id"], "version_id": vid, **e} for e in result["elements"]]
        for i in range(0, len(docs), 1000):
            await db.bim_elements.insert_many(docs[i:i + 1000])
        storeys = sorted([s for s in result["spatial"] if s["ifc_type"] == "IFCBUILDINGSTOREY"], key=lambda s: s["elevation"] or 0)
        await db.bim_versions.update_one({"id": vid}, {"$set": {
            "status": "pret", "progress": 100, "stage": "Terminé", "error": None, "finished_at": now_iso(),
            "schema": result["schema"], "length_unit": result["length_unit"], "entity_count": result["entity_count"],
            "element_count": len(docs), "storeys": [{"name": s["name"], "elevation": s["elevation"]} for s in storeys],
            "spatial": result["spatial"][:2000],
        }})
        await db.bim_models.update_one({"id": job["model_id"]}, {"$set": {"current_version_id": vid, "updated_at": now_iso()}})
        await audit(None, job["project_id"], "bim.import_ok", "bim_version", vid, f"Maquette traitée : {len(docs)} objets IFC extraits ({result['schema']})")
        await apply_seed_rules(job)
    except Exception as e:  # noqa: BLE001 - every failure must be reported on the job
        logger.exception("Échec du traitement IFC %s", vid)
        failed = job.get("attempts", 1) >= MAX_ATTEMPTS
        await db.bim_versions.update_one({"id": vid}, {"$set": {
            "status": "echec" if failed else "en_attente", "error": str(e)[:500],
            "stage": "Échec définitif" if failed else f"Nouvelle tentative ({job.get('attempts', 1)}/{MAX_ATTEMPTS})",
        }})
        if failed:
            await audit(None, job["project_id"], "bim.import_failed", "bim_version", vid, f"Échec du traitement IFC : {str(e)[:200]}")


async def apply_seed_rules(job):
    from services.linking import apply_rule
    project = await db.projects.find_one({"id": job["project_id"]})
    pending = (project or {}).get("pending_seed_rules") or []
    if not pending:
        return
    for r in pending:
        task = await db.tasks.find_one({"project_id": job["project_id"], "code": r["task_code"]})
        if task:
            await apply_rule(None, job["project_id"], task["id"], job["model_id"], r["name"], r["filters"])
    await db.projects.update_one({"id": job["project_id"]}, {"$unset": {"pending_seed_rules": ""}})


async def worker_loop():
    await resume_interrupted()
    while True:
        try:
            job = await db.bim_versions.find_one_and_update(
                {"status": "en_attente"},
                {"$set": {"status": "traitement", "started_at": now_iso(), "progress": 1, "stage": "Lecture du fichier"}, "$inc": {"attempts": 1}},
                sort=[("created_at", 1)], return_document=ReturnDocument.AFTER,
            )
            if not job:
                await asyncio.sleep(2)
                continue
            await process(job)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Erreur de la file de traitement BIM")
            await asyncio.sleep(5)
