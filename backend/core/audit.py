import logging
from core.db import db, new_id, now_iso

logger = logging.getLogger("audit")


async def audit(user, project_id, action, entity, entity_id, summary, before=None, after=None):
    entry = {
        "id": new_id(), "project_id": project_id, "user_id": user["id"] if user else None,
        "user_email": user["email"] if user else "système", "action": action, "entity": entity,
        "entity_id": entity_id, "summary": summary, "before": before, "after": after, "at": now_iso(),
    }
    await db.audit_logs.insert_one(entry)
    logger.info("audit action=%s entity=%s id=%s project=%s user=%s", action, entity, entity_id, project_id, entry["user_email"])


def diff(old: dict, new: dict, fields):
    before, after = {}, {}
    for f in fields:
        if f in new and old.get(f) != new[f]:
            before[f], after[f] = old.get(f), new[f]
    return before, after
