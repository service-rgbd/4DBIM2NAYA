import os
import uuid
from datetime import datetime, timezone, date
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
fs = AsyncIOMotorGridFSBucket(db, bucket_name="files")


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today() -> date:
    return datetime.now(timezone.utc).date()


def clean(doc):
    if doc is None:
        return None
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


async def create_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.projects.create_index("id", unique=True)
    await db.projects.create_index("reference", unique=True)
    await db.project_members.create_index([("project_id", 1), ("user_id", 1)], unique=True)
    await db.tasks.create_index("id", unique=True)
    await db.tasks.create_index([("project_id", 1), ("deleted_at", 1), ("sort_order", 1)])
    await db.dependencies.create_index([("project_id", 1)])
    await db.dependencies.create_index([("predecessor_id", 1), ("successor_id", 1)], unique=True)
    await db.progress_records.create_index([("task_id", 1), ("date", 1)])
    await db.baselines.create_index([("project_id", 1)])
    await db.bim_models.create_index([("project_id", 1)])
    await db.bim_versions.create_index([("model_id", 1), ("version_no", 1)], unique=True)
    await db.bim_versions.create_index([("status", 1), ("created_at", 1)])
    await db.bim_elements.create_index([("version_id", 1), ("global_id", 1)], unique=True)
    await db.bim_elements.create_index([("version_id", 1), ("ifc_type", 1), ("storey", 1)])
    await db.links.create_index([("task_id", 1), ("model_id", 1), ("global_id", 1)], unique=True)
    await db.links.create_index([("project_id", 1), ("model_id", 1)])
    await db.link_rules.create_index([("project_id", 1)])
    await db.audit_logs.create_index([("project_id", 1), ("at", -1)])
    await db.audit_logs.create_index([("entity_id", 1)])
    await db.issues.create_index("id", unique=True)
    await db.issues.create_index([("project_id", 1), ("deleted_at", 1), ("status", 1)])
    await db.issues.create_index([("project_id", 1), ("global_id", 1)])
    await db.issues.create_index([("project_id", 1), ("reference", 1)], unique=True)
