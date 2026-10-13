"""Unit tests of the CPM engine and the IFC metadata extractor (no database access)."""
import sys
from datetime import date
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.scheduling import compute_schedule, topo_order, CycleError, WorkCalendar  # noqa: E402
from services.ifc_parser import parse_ifc, parse_args  # noqa: E402

CAL = {"working_days": [0, 1, 2, 3, 4], "exceptions": [{"date": "2026-11-11", "type": "ferie"}]}


def t(i, dur, start="2026-11-02", ms=False):
    return {"id": i, "start": start, "duration": dur, "is_milestone": ms}


def d(a, b, typ="FS", lag=0):
    return {"predecessor_id": a, "successor_id": b, "type": typ, "lag": lag}


def test_fs_chain_skips_weekend_and_holiday():
    res, finish = compute_schedule([t("A", 5), t("B", 3)], [d("A", "B")], CAL)
    assert res["A"]["early_start"] == "2026-11-02" and res["A"]["early_finish"] == "2026-11-06"
    assert res["B"]["early_start"] == "2026-11-09" and res["B"]["early_finish"] == "2026-11-12"  # 11/11 férié
    assert finish == "2026-11-12"


def test_ss_ff_lag_and_critical_path():
    res, _ = compute_schedule([t("A", 10), t("B", 2), t("C", 3)], [d("A", "B", "SS", 2), d("A", "C", "FF")], CAL)
    assert res["B"]["early_start"] == "2026-11-04"
    assert res["C"]["early_finish"] == res["A"]["early_finish"]
    assert res["A"]["is_critical"] and res["C"]["is_critical"] and not res["B"]["is_critical"]
    assert res["B"]["total_float"] > 0


def test_milestone_dated_on_predecessor_finish():
    res, _ = compute_schedule([t("A", 5), t("M", 0, ms=True)], [d("A", "M")], CAL)
    assert res["M"]["early_start"] == res["A"]["early_finish"]


def test_start_constraint_respected_and_cycle_detected():
    res, _ = compute_schedule([t("A", 2), t("B", 2, start="2026-12-01")], [d("A", "B")], CAL)
    assert res["B"]["early_start"] == "2026-12-01"
    with pytest.raises(CycleError):
        topo_order(["A", "B", "C"], [d("A", "B"), d("B", "C"), d("C", "A")])


def test_working_days_between():
    cal = WorkCalendar(CAL, date(2026, 11, 1))
    assert cal.working_days_between(date(2026, 11, 9), date(2026, 11, 13)) == 4


def test_step_parser_strings_and_typed_values():
    a = parse_args("'2O2Fr$t4X7Zf8NOew3FLOH',#5,'Mur l''est',$,.T.,IFCLABEL('x'),(#1,#2),1.5E2")
    assert a[0] == "2O2Fr$t4X7Zf8NOew3FLOH" and a[2] == "Mur l'est" and a[4] is True
    assert a[5] == {"type": "IFCLABEL", "value": "x"} and a[6] == [1, 2] and a[7] == 150.0


def test_ifc_extraction_on_sample():
    r = parse_ifc((Path(__file__).resolve().parents[1] / "seed" / "Duplex_A.ifc").read_bytes())
    assert r["schema"] == "IFC2X3" and len(r["elements"]) > 200
    gids = [e["global_id"] for e in r["elements"]]
    assert len(gids) == len(set(gids))
    assert {"Level 1", "Level 2", "Roof", "T/FDN"} <= {e["storey"] for e in r["elements"]}


def test_invalid_ifc_rejected():
    with pytest.raises(ValueError):
        parse_ifc(b"not an ifc file")
