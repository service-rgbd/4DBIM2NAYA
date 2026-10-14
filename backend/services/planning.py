from collections import defaultdict
from datetime import date, timedelta
from typing import Callable, Optional
from fastapi import HTTPException
from pymongo import UpdateOne
from core.db import db, today
from services.scheduling import compute_schedule, CycleError, WorkCalendar, planned_fraction, health


async def load_graph(project_id: str):
    tasks = await db.tasks.find({"project_id": project_id, "deleted_at": None}, {"_id": 0}).sort("sort_order", 1).to_list(5000)
    deps = await db.dependencies.find({"project_id": project_id}, {"_id": 0}).to_list(20000)
    return tasks, deps


def cycle_message(tasks: list, ids: list) -> str:
    names = [t["code"] + " " + t["name"] for t in tasks if t["id"] in set(ids)]
    return "Dépendance circulaire détectée entre : " + ", ".join(names[:8])


def _schedule_or_400(tasks: list, deps: list, calendar: dict):
    try:
        return compute_schedule(tasks, deps, calendar)
    except CycleError as e:
        raise HTTPException(status_code=400, detail=cycle_message(tasks, e.task_ids)) from e


async def recompute(project_id: str):
    """Recalculate CPM dates and critical path; persisted so states are reproducible from stored data."""
    project = await db.projects.find_one({"id": project_id})
    tasks, deps = await load_graph(project_id)
    res, finish = _schedule_or_400(tasks, deps, project.get("calendar"))
    ops = [UpdateOne({"id": tid}, {"$set": v}) for tid, v in res.items()]
    if ops:
        await db.tasks.bulk_write(ops)
    await db.projects.update_one({"id": project_id}, {"$set": {"computed_finish": finish}})
    return res, finish


def simulate(tasks: list, deps: list, calendar: dict, overrides: dict):
    return _schedule_or_400([{**t, **overrides.get(t["id"], {})} for t in tasks], deps, calendar)


def with_health(task: dict, at: Optional[date] = None) -> dict:
    task["health"] = health(task, at or today())
    return task


def _work(tasks: list) -> list:
    """Scheduled, non-cancelled, non-milestone activities: the basis of duration-weighted progress."""
    return [t for t in tasks if t.get("status") != "annule" and not t.get("is_milestone") and t.get("early_start")]


def _weighted(work: list, fraction: Callable[[dict], float]) -> float:
    total = sum(int(t["duration"]) for t in work) or 1
    return round(sum(int(t["duration"]) * fraction(t) for t in work) / total * 100, 1)


def _in_progress(t: dict) -> bool:
    return bool(t.get("actual_start")) and not t.get("actual_end") and t.get("status") != "annule"


def kpis(tasks: list, records: list, calendar: dict, at: date):
    work = _work(tasks)
    cal = WorkCalendar(calendar, min((date.fromisoformat(t["early_start"]) for t in work), default=at))
    states = [health(t, at) for t in tasks if t.get("early_start")]
    return {
        "planned_progress": _weighted(work, lambda t: planned_fraction(t, at, cal)),
        "actual_progress": _weighted(work, lambda t: t.get("progress", 0) / 100),
        "tasks_total": len(tasks),
        "tasks_done": states.count("termine"),
        "tasks_in_progress": sum(1 for t in tasks if _in_progress(t)),
        "tasks_delayed": states.count("en_retard"),
        "tasks_blocked": states.count("bloque"),
        "tasks_critical": sum(1 for t in tasks if t.get("is_critical")),
    }, cal


def _progress_at(records: list, day_iso: str) -> float:
    """Last recorded progress on or before the given day (records sorted by date)."""
    last = 0
    for r in records:
        if r["date"] > day_iso:
            break
        last = r["progress"]
    return last / 100


def s_curve(tasks: list, records: list, cal: WorkCalendar, start: date, end: date) -> list:
    work = _work(tasks)
    by_task = defaultdict(list)
    for r in sorted(records, key=lambda r: r["date"]):
        by_task[r["task_id"]].append(r)
    points, d, now = [], start, today()
    while d <= end + timedelta(days=6):
        point = {"date": d.isoformat(), "prevu": _weighted(work, lambda t, day=d: planned_fraction(t, day, cal))}
        if d <= now:
            point["reel"] = _weighted(work, lambda t, day=d.isoformat(): _progress_at(by_task[t["id"]], day))
        points.append(point)
        d += timedelta(days=7)
    return points


def dashboard_data(project: dict, tasks: list, records: list, linked: set, now: date) -> dict:
    k, cal = kpis(tasks, records, project.get("calendar"), now)
    starts = sorted(t["early_start"] for t in tasks if t.get("early_start"))
    curve = s_curve(tasks, records, cal, date.fromisoformat(starts[0]), date.fromisoformat(project.get("computed_finish") or starts[-1])) if starts else []
    rows = [with_health(task, now) for task in tasks]
    upcoming = [r for r in rows if r["health"] not in ("termine", "annule") and r["early_finish"] >= now.isoformat()]
    return {
        "today": now.isoformat(), "kpis": k, "s_curve": curve, "computed_finish": project.get("computed_finish"),
        "delayed": [r for r in rows if r["health"] == "en_retard"][:20],
        "blocked": [r for r in rows if r["health"] == "bloque"],
        "milestones": [r for r in rows if r.get("is_milestone")],
        "upcoming": sorted(upcoming, key=lambda r: r["early_finish"])[:6],
        "tasks_linked": len(linked),
        "tasks_unlinked": sum(1 for r in rows if r["id"] not in linked and not r.get("is_milestone")),
    }
