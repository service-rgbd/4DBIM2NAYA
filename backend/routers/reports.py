from fastapi import APIRouter, Depends
from fastapi.responses import Response
from core.db import db, today
from core.audit import audit
from core.schemas import Report4DIn
from core.security import get_current_user, authorize
from services.planning import dashboard_data
from services.report4d import build_report

router = APIRouter(tags=["reports"])


@router.post("/projects/{pid}/reports/4d")
async def report_4d(pid: str, body: Report4DIn, user=Depends(get_current_user)):
    p = await authorize(user, pid, "export")
    tasks = await db.tasks.find({"project_id": pid, "deleted_at": None}, {"_id": 0}).sort("sort_order", 1).to_list(5000)
    records = await db.progress_records.find({"project_id": pid}, {"_id": 0}).to_list(50000)
    linked = set(await db.links.distinct("task_id", {"project_id": pid}))
    dash = dashboard_data(p, tasks, records, linked, today())
    dash["bim"] = {"links": await db.links.count_documents({"project_id": pid})}
    pdf = build_report(p, dash, tasks, body.mode, body.model_name, [c.model_dump(mode="json") for c in body.captures])
    await audit(user, pid, "report.4d", "project", pid, f"Rapport PDF 4D généré ({len(body.captures)} capture(s), mode {body.mode})")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="rapport-4d-{p["reference"]}-{today().isoformat()}.pdf"'})
