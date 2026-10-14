import re
from typing import Optional
from fastapi import HTTPException
from pymongo.errors import BulkWriteError
from core.db import db, new_id, now_iso
from core.audit import audit


def _variants(v: str) -> list:
    out = [v]
    lv = v.strip().lower()
    if lv in ("true", "vrai", "oui"):
        out.append(True)
    if lv in ("false", "faux", "non"):
        out.append(False)
    try:
        out.append(float(v.replace(",", ".")))
        out.append(int(v))
    except ValueError:
        pass
    return out


def rule_query(version_id: str, f: dict) -> dict:
    q = {"version_id": version_id}
    if f.get("ifc_types"):
        q["ifc_type"] = {"$in": f["ifc_types"]}
    if f.get("storeys"):
        q["storey"] = {"$in": f["storeys"]}
    if f.get("disciplines"):
        q["discipline"] = {"$in": f["disciplines"]}
    if f.get("name_contains"):
        q["name"] = {"$regex": re.escape(f["name_contains"]), "$options": "i"}
    if f.get("property_name"):
        em = {"name": f["property_name"]}
        if f.get("property_value"):
            em["value"] = {"$in": _variants(f["property_value"])}
        q["properties"] = {"$elemMatch": em}
    return q


async def current_version(model_id: str, project_id: str):
    model = await db.bim_models.find_one({"id": model_id, "project_id": project_id, "deleted_at": None})
    if not model:
        raise HTTPException(status_code=404, detail="Maquette introuvable dans ce projet")
    if not model.get("current_version_id"):
        raise HTTPException(status_code=409, detail="Aucune version traitée de cette maquette n'est disponible")
    return model, model["current_version_id"]


async def create_links(user: Optional[dict], project_id: str, task_id: str, model_id: str, global_ids: list, rule_id: Optional[str] = None) -> int:
    docs = [{"id": new_id(), "project_id": project_id, "task_id": task_id, "model_id": model_id, "global_id": g,
             "rule_id": rule_id, "created_by": user["email"] if user else "système", "created_at": now_iso()} for g in dict.fromkeys(global_ids)]
    if not docs:
        return 0
    try:
        r = await db.links.insert_many(docs, ordered=False)
        return len(r.inserted_ids)
    except BulkWriteError as e:
        return e.details.get("nInserted", 0)


async def apply_rule(user: Optional[dict], project_id: str, task_id: str, model_id: str, name: str, filters: dict):
    _, vid = await current_version(model_id, project_id)
    gids = [e["global_id"] async for e in db.bim_elements.find(rule_query(vid, filters), {"global_id": 1, "_id": 0})]
    rule = {"id": new_id(), "project_id": project_id, "task_id": task_id, "model_id": model_id, "name": name,
            "filters": filters, "matched_count": len(gids), "created_by": user["email"] if user else "système", "created_at": now_iso()}
    await db.link_rules.insert_one(rule)
    created = await create_links(user, project_id, task_id, model_id, gids, rule["id"])
    rule.pop("_id", None)
    await audit(user, project_id, "link.rule_applied", "link_rule", rule["id"],
                f"Règle « {name} » : {created} nouvelle(s) liaison(s) sur {len(gids)} objet(s) correspondant(s)", after={"filters": filters, "task_id": task_id})
    return rule, created
