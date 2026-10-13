from datetime import date, timedelta
from fastapi import HTTPException
from pymongo import UpdateOne
from core.db import db, today
from services.scheduling import compute_schedule, CycleError, WorkCalendar, planned_fraction, health


async def load_graph(project_id):
    tasks = await db.tasks.find({"project_id": project_id, "deleted_at": None}, {"_id": 0}).sort("sort_order", 1).to_list(5000)
    deps = await db.dependencies.find({"project_id": project_id}, {"_id": 0}).to_list(20000)
    return tasks, deps


def cycle_message(tasks, ids):
    names = [t["code"] + " " + t["name"] for t in tasks if t["id"] in set(ids)]
    return "Dépendance circulaire détectée entre : " + ", ".join(names[:8])


async def recompute(project_id):
    """Recalculate CPM dates and critical path; persisted so states are reproducible from stored data."""
    project = await db.projects.find_one({"id": project_id})
    tasks, deps = await load_graph(project_id)
    try:
        res, finish = compute_schedule(tasks, deps, project.get("calendar"))
    except CycleError as e:
        raise HTTPException(status_code=400, detail=cycle_message(tasks, e.task_ids))
    ops = [UpdateOne({"id": tid}, {"$set": v}) for tid, v in res.items()]
    if ops:
        await db.tasks.bulk_write(ops)
    await db.projects.update_one({"id": project_id}, {"$set": {"computed_finish": finish}})
    return res, finish


def simulate(tasks, deps, calendar, overrides):
    patched = [{**t, **overrides.get(t["id"], {})} for t in tasks]
    try:
        return compute_schedule(patched, deps, calendar)
    except CycleError as e:
        raise HTTPException(status_code=400, detail=cycle_message(tasks, e.task_ids))


def with_health(task, at=None):
    task["health"] = health(task, at or today())
    return task


def kpis(tasks, records, calendar, at: date):
    work = [t for t in tasks if t.get("status") != "annule" and not t.get("is_milestone") and t.get("early_start")]
    total = sum(int(t["duration"]) for t in work) or 1
    cal = WorkCalendar(calendar, min((date.fromisoformat(t["early_start"]) for t in work), default=at))
    planned = sum(int(t["duration"]) * planned_fraction(t, at, cal) for t in work) / total
    actual = sum(int(t["duration"]) * (t.get("progress", 0) / 100) for t in work) / total
    states = [health(t, at) for t in tasks if t.get("early_start")]
    return {
        "planned_progress": round(planned * 100, 1),
        "actual_progress": round(actual * 100, 1),
        "tasks_total": len(tasks),
        "tasks_done": states.count("termine"),
        "tasks_in_progress": sum(1 for t in tasks if t.get("actual_start") and not t.get("actual_end") and t.get("status") != "annule"),
        "tasks_delayed": states.count("en_retard"),
        "tasks_blocked": states.count("bloque"),
        "tasks_critical": sum(1 for t in tasks if t.get("is_critical")),
    }, cal


def s_curve(tasks, records, cal, start: date, end: date):
    work = [t for t in tasks if t.get("status") != "annule" and not t.get("is_milestone") and t.get("early_start")]
    total = sum(int(t["duration"]) for t in work) or 1
    by_task = {}
    for r in sorted(records, key=lambda r: r["date"]):
        by_task.setdefault(r["task_id"], []).append(r)
    points, d, now = [], start, today()
    while d <= end + timedelta(days=6):
        p = sum(int(t["duration"]) * planned_fraction(t, d, cal) for t in work) / total
        point = {"date": d.isoformat(), "prevu": round(p * 100, 1)}
        if d <= now:
            a = 0
            for t in work:
                last = [r for r in by_task.get(t["id"], []) if r["date"] <= d.isoformat()]
                a += int(t["duration"]) * (last[-1]["progress"] / 100 if last else 0)
            point["reel"] = round(a / total * 100, 1)
        points.append(point)
        d += timedelta(days=7)
    return points
