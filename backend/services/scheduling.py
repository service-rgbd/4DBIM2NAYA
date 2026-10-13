"""CPM scheduling engine on a working-day calendar.

Convention: each task has a working-day index ES (first day) and EF = ES + duration (exclusive).
Constraint: task.start acts as 'start no earlier than'. Lags are expressed in working days.
"""
import bisect
from collections import defaultdict, deque
from datetime import date, timedelta


class CycleError(Exception):
    def __init__(self, task_ids):
        super().__init__("cycle")
        self.task_ids = task_ids


class WorkCalendar:
    def __init__(self, cal: dict, origin: date):
        cal = cal or {}
        self.working_days = set(cal.get("working_days", [0, 1, 2, 3, 4]))
        exc = cal.get("exceptions", [])
        self.holidays = {e["date"] for e in exc if e.get("type", "ferie") == "ferie"}
        self.extra = {e["date"] for e in exc if e.get("type") == "ouvre"}
        self.days = []
        self.ords = []
        self._cursor = origin - timedelta(days=1)

    def is_working(self, d: date) -> bool:
        s = d.isoformat()
        if s in self.extra:
            return True
        if s in self.holidays:
            return False
        return d.weekday() in self.working_days

    def _extend(self):
        for _ in range(3660):
            self._cursor += timedelta(days=1)
            if self.is_working(self._cursor):
                self.days.append(self._cursor)
                self.ords.append(self._cursor.toordinal())
                return
        raise ValueError("Calendrier sans jour ouvré")

    def day(self, i: int) -> date:
        i = max(i, 0)
        while len(self.days) <= i:
            self._extend()
        return self.days[i]

    def index_of(self, d: date) -> int:
        """First working day >= d."""
        while not self.ords or self.ords[-1] < d.toordinal():
            self._extend()
        return bisect.bisect_left(self.ords, d.toordinal())

    def working_days_between(self, a: date, b: date) -> int:
        """Working days in [a, b] inclusive."""
        if b < a:
            return 0
        return self.index_of(b + timedelta(days=1)) - self.index_of(a)


def topo_order(task_ids, deps):
    indeg = {t: 0 for t in task_ids}
    succ = defaultdict(list)
    for d in deps:
        if d["predecessor_id"] in indeg and d["successor_id"] in indeg:
            succ[d["predecessor_id"]].append(d["successor_id"])
            indeg[d["successor_id"]] += 1
    q = deque(t for t, n in indeg.items() if n == 0)
    order = []
    while q:
        t = q.popleft()
        order.append(t)
        for s in succ[t]:
            indeg[s] -= 1
            if indeg[s] == 0:
                q.append(s)
    if len(order) != len(indeg):
        raise CycleError([t for t, n in indeg.items() if n > 0])
    return order


def _d(v):
    return v if isinstance(v, date) else date.fromisoformat(v)


def compute_schedule(tasks, deps, calendar: dict):
    if not tasks:
        return {}, None
    origin = min(_d(t["start"]) for t in tasks)
    cal = WorkCalendar(calendar, origin)
    by_id = {t["id"]: t for t in tasks}
    order = topo_order(list(by_id), deps)
    preds, succs = defaultdict(list), defaultdict(list)
    for d in deps:
        if d["predecessor_id"] in by_id and d["successor_id"] in by_id:
            preds[d["successor_id"]].append(d)
            succs[d["predecessor_id"]].append(d)
    dur = {i: (0 if t.get("is_milestone") else int(t["duration"])) for i, t in by_id.items()}
    ES, EF, drivers, after_finish = {}, {}, {}, {}
    for tid in order:
        es = cal.index_of(_d(by_id[tid]["start"]))
        drv, af = [], False
        for d in preds[tid]:
            p, lag, n = d["predecessor_id"], d.get("lag", 0), dur[tid]
            req = {"FS": EF[p] + lag, "SS": ES[p] + lag, "FF": EF[p] + lag - n, "SF": ES[p] + lag - n}[d["type"]]
            if req > es:
                es, drv, af = req, [d], d["type"] in ("FS", "FF")
            elif req == es:
                drv.append(d)
        ES[tid], EF[tid] = es, es + dur[tid]
        drivers[tid] = drv
        after_finish[tid] = af and dur[tid] == 0 and es > 0
    finish = max(EF.values())
    LF = {}
    for tid in reversed(order):
        lf, n = finish, dur[tid]
        for d in succs[tid]:
            s, lag = d["successor_id"], d.get("lag", 0)
            ls_s = LF[s] - dur[s]
            req = {"FS": ls_s - lag, "SS": ls_s - lag + n, "FF": LF[s] - lag, "SF": LF[s] - lag + n}[d["type"]]
            lf = min(lf, req)
        LF[tid] = lf
    result = {}
    for tid in order:
        n = dur[tid]
        tf = (LF[tid] - n) - ES[tid]
        # a milestone reached at the end of a predecessor is dated on that predecessor's last working day
        ms_day = cal.day(ES[tid] - 1 if after_finish[tid] else ES[tid])
        result[tid] = {
            "early_start": (cal.day(ES[tid]) if n > 0 else ms_day).isoformat(),
            "early_finish": (cal.day(EF[tid] - 1) if n > 0 else ms_day).isoformat(),
            "total_float": tf,
            "is_critical": tf <= 0,
            "driven_by": [d["predecessor_id"] for d in drivers[tid]],
        }
    return result, max(r["early_finish"] for r in result.values())


def planned_fraction(task, at: date, cal: WorkCalendar) -> float:
    n = 0 if task.get("is_milestone") else int(task["duration"])
    es, ef = _d(task["early_start"]), _d(task["early_finish"])
    if at < es:
        return 0.0
    if at >= ef or n == 0:
        return 1.0
    return min(1.0, cal.working_days_between(es, at) / n)


def health(task, today: date) -> str:
    st = task.get("status")
    if st in ("termine", "annule", "bloque"):
        return st
    if task.get("actual_end"):
        return "termine"
    if today > _d(task["early_finish"]):
        return "en_retard"
    if not task.get("actual_start") and today > _d(task["early_start"]):
        return "en_retard"
    if task.get("actual_start"):
        return "en_cours"
    return "a_realiser"
