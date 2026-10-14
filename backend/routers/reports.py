import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from core.db import db, fs, today
from core.audit import audit
from core.schemas import Report4DIn
from core.security import get_current_user, authorize
from services.planning import dashboard_data
from services.report4d import build_report
from services.issues_report import build_issues_report, thumbnail

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


async def _thumbnails(items: list) -> dict:
    images = {}
    for i in items:
        for ph in i.get("photos", []):
            stream = await fs.open_download_stream(ph["file_id"])
            images[ph["id"]] = await asyncio.to_thread(thumbnail, await stream.read())
    return images


@router.get("/projects/{pid}/reports/issues")
async def report_issues(pid: str, status: str = "", priority: str = "", company: str = "", user=Depends(get_current_user)):
    p = await authorize(user, pid, "export")
    filters = {"status": status, "priority": priority, "company": company}
    q = {"project_id": pid, "deleted_at": None, **{k: v for k, v in filters.items() if v}}
    items = await db.issues.find(q, {"_id": 0}).to_list(2000)
    pdf = await asyncio.to_thread(build_issues_report, p, items, filters, await _thumbnails(items), today().isoformat())
    await audit(user, pid, "report.issues", "project", pid, f"Export PDF des réserves ({len(items)} réserve(s), entreprise : {company or 'toutes'})")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="reserves-{p["reference"]}-{today().isoformat()}.pdf"'})
