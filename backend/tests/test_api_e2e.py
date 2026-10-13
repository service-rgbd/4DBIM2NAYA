"""
End-to-end API tests for BIM 4D SaaS.
Schemas corrected per core/schemas.py:
- Project: start_planned/end_planned
- Task: start / duration
- Dependency: lag (not lag_days)
- Progress: progress/date
GET /projects/{pid}/tasks returns {"tasks": [...], "dependencies": [...]}
"""
import os
import io
import time
import uuid
import pytest
import requests
from pathlib import Path

BASE = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip()
            break
API = BASE.rstrip("/") + "/api/v1"

ADMIN = {"email": "admin@bim4d.fr", "password": "Bim4D-Admin-2026"}
VIEWER = {"email": "lecteur@bim4d.fr", "password": "Bim4D-Lecteur-2026"}
SEED_IFC = Path("/app/backend/seed/Duplex_A.ifc")


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s

@pytest.fixture(scope="session")
def viewer():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=VIEWER, timeout=30)
    assert r.status_code == 200, f"viewer login failed: {r.status_code} {r.text}"
    return s

@pytest.fixture(scope="session")
def demo_project_id(admin):
    r = admin.get(f"{API}/projects", timeout=30)
    assert r.status_code == 200
    for p in r.json():
        if p.get("reference") == "DEMO-DUPLEX":
            return p["id"]
    pytest.fail("DEMO-DUPLEX project not found")

@pytest.fixture(scope="session")
def test_project_id(admin):
    ref = f"TEST_{uuid.uuid4().hex[:8].upper()}"
    body = {
        "reference": ref, "name": "TEST Project",
        "start_planned": "2026-10-01", "end_planned": "2027-06-30",
    }
    r = admin.post(f"{API}/projects", json=body, timeout=30)
    assert r.status_code == 201, f"create project failed: {r.status_code} {r.text}"
    return r.json()["id"]


# ---------- Auth ----------
class TestAuth:
    def test_login_sets_httponly_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200
        assert "access_token" in s.cookies

    def test_me_returns_user(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN["email"]
        assert "role" in data

    def test_wrong_password_401_french(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "nobody@bim4d.fr", "password": "wrong"})
        assert r.status_code == 401
        detail = (r.json().get("detail") or "").lower()
        assert any(w in detail for w in ["identifiant", "incorrect", "invalid", "mot de passe", "verrouill"]), f"detail={detail}"

    def test_logout(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json=ADMIN)
        r = s.post(f"{API}/auth/logout")
        assert r.status_code in (200, 204)
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401

    def test_protected_requires_auth(self):
        r = requests.get(f"{API}/projects")
        assert r.status_code == 401


# ---------- Permissions ----------
class TestPermissions:
    def test_viewer_can_read_demo(self, viewer, demo_project_id):
        r = viewer.get(f"{API}/projects/{demo_project_id}")
        assert r.status_code == 200

    def test_viewer_cannot_create_task(self, viewer, demo_project_id):
        r = viewer.post(f"{API}/projects/{demo_project_id}/tasks",
                        json={"name": "VIEWER_SHOULD_FAIL", "start": "2026-10-20", "duration": 1})
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_viewer_cannot_post_dependency(self, viewer, demo_project_id, admin):
        rt = admin.get(f"{API}/projects/{demo_project_id}/tasks")
        tasks = rt.json().get("tasks") or []
        if len(tasks) < 2:
            pytest.skip("not enough tasks")
        r = viewer.post(f"{API}/projects/{demo_project_id}/dependencies",
                        json={"predecessor_id": tasks[0]["id"], "successor_id": tasks[1]["id"], "type": "FS", "lag": 0})
        assert r.status_code == 403

    def test_viewer_only_sees_member_projects(self, viewer):
        r = viewer.get(f"{API}/projects")
        assert r.status_code == 200
        refs = [p["reference"] for p in r.json()]
        assert "DEMO-DUPLEX" in refs
        assert all(ref == "DEMO-DUPLEX" for ref in refs), f"viewer saw: {refs}"


# ---------- Projects ----------
class TestProjects:
    def test_list_contains_demo(self, admin):
        r = admin.get(f"{API}/projects")
        assert r.status_code == 200
        demo = next((p for p in r.json() if p["reference"] == "DEMO-DUPLEX"), None)
        assert demo is not None
        assert demo.get("is_demo") is True

    def test_duplicate_reference_409(self, admin, test_project_id):
        ref = admin.get(f"{API}/projects/{test_project_id}").json()["reference"]
        r = admin.post(f"{API}/projects", json={"reference": ref, "name": "dup", "start_planned": "2026-01-01", "end_planned": "2026-12-31"})
        assert r.status_code == 409

    def test_invalid_status_transition(self, admin, test_project_id):
        r = admin.post(f"{API}/projects/{test_project_id}/status", json={"status": "livre"})
        # from preparation → livre: should be invalid (400) or 422
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"


# ---------- Planning / CPM ----------
class TestPlanning:
    def test_get_tasks_with_cpm(self, admin, demo_project_id):
        r = admin.get(f"{API}/projects/{demo_project_id}/tasks")
        assert r.status_code == 200
        payload = r.json()
        tasks = payload.get("tasks") or []
        assert len(tasks) > 0
        t = tasks[0]
        for k in ["early_start", "early_finish", "total_float", "is_critical"]:
            assert k in t, f"missing CPM field {k} in task keys: {list(t.keys())}"
        assert any(x.get("is_critical") for x in tasks), "no critical task"

    def test_create_patch_version_conflict(self, admin, test_project_id):
        r = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "T1", "start": "2026-10-20", "duration": 3})
        assert r.status_code == 201, r.text
        task = r.json()
        tid = task["id"]
        v = task.get("version", 1)
        r2 = admin.patch(f"{API}/tasks/{tid}", json={"name": "T1-renamed", "version": v})
        assert r2.status_code == 200, r2.text
        r3 = admin.patch(f"{API}/tasks/{tid}", json={"name": "T1-conflict", "version": v})
        assert r3.status_code == 409

    def test_duplicate_and_delete_task(self, admin, test_project_id):
        r = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "ToDup", "start": "2026-10-21", "duration": 2})
        assert r.status_code == 201, r.text
        tid = r.json()["id"]
        r2 = admin.post(f"{API}/tasks/{tid}/duplicate")
        assert r2.status_code == 201
        r3 = admin.delete(f"{API}/tasks/{tid}")
        assert r3.status_code in (200, 204)


# ---------- Dependencies ----------
class TestDependencies:
    def test_cycle_rejected(self, admin, test_project_id):
        a = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "DepA", "start": "2026-10-22", "duration": 2}).json()
        b = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "DepB", "start": "2026-10-25", "duration": 2}).json()
        r1 = admin.post(f"{API}/projects/{test_project_id}/dependencies",
                        json={"predecessor_id": a["id"], "successor_id": b["id"], "type": "FS", "lag": 0})
        assert r1.status_code == 201, r1.text
        r2 = admin.post(f"{API}/projects/{test_project_id}/dependencies",
                        json={"predecessor_id": b["id"], "successor_id": a["id"], "type": "FS", "lag": 0})
        assert r2.status_code == 400
        detail = (r2.json().get("detail") or "").lower()
        assert "circulaire" in detail or "cycle" in detail

    def test_self_dependency(self, admin, test_project_id):
        a = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "Self", "start": "2026-10-27", "duration": 1}).json()
        r = admin.post(f"{API}/projects/{test_project_id}/dependencies",
                       json={"predecessor_id": a["id"], "successor_id": a["id"], "type": "FS", "lag": 0})
        assert r.status_code in (400, 422)


# ---------- Drag preview ----------
class TestDragPreview:
    def test_preview_move(self, admin, demo_project_id):
        tasks = admin.get(f"{API}/projects/{demo_project_id}/tasks").json().get("tasks") or []
        assert tasks, "no demo tasks"
        tid = tasks[0]["id"]
        r = admin.post(f"{API}/tasks/{tid}/preview-move",
                       json={"start": tasks[0]["start"]})
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["impacted", "effective_start", "effective_finish"]:
            assert k in data, f"missing {k}, got keys {list(data.keys())}"


# ---------- Progress ----------
class TestProgress:
    def test_future_date_422(self, admin, test_project_id):
        t = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "Prog", "start": "2026-10-28", "duration": 2}).json()
        r = admin.post(f"{API}/tasks/{t['id']}/progress",
                       json={"date": "2099-01-01", "progress": 50})
        assert r.status_code == 422

    def test_close_without_reason_422_with_reason_ok(self, admin, test_project_id):
        t = admin.post(f"{API}/projects/{test_project_id}/tasks",
                       json={"name": "Close", "start": "2026-10-29", "duration": 2}).json()
        v = t.get("version", 1)
        r = admin.patch(f"{API}/tasks/{t['id']}", json={"status": "termine", "version": v})
        assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text[:200]}"
        r2 = admin.patch(f"{API}/tasks/{t['id']}",
                         json={"status": "termine", "exception_reason": "Closed for test", "version": v})
        assert r2.status_code == 200, r2.text


# ---------- Baselines ----------
class TestBaselines:
    def test_create_and_list(self, admin, test_project_id):
        r = admin.post(f"{API}/projects/{test_project_id}/baselines", json={"name": "B1"})
        assert r.status_code == 201, r.text
        r2 = admin.get(f"{API}/projects/{test_project_id}/baselines")
        assert r2.status_code == 200
        assert len(r2.json()) >= 1


# ---------- Calendar ----------
class TestCalendar:
    def test_update_calendar(self, admin, test_project_id):
        body = {
            "working_days": [0, 1, 2, 3, 4],
            "exceptions": [{"date": "2026-12-25", "type": "ferie", "label": "Noël"}],
        }
        r = admin.put(f"{API}/projects/{test_project_id}/calendar", json=body)
        assert r.status_code in (200, 204), r.text


# ---------- BIM ----------
class TestBIM:
    def test_demo_model_ready(self, admin, demo_project_id):
        r = admin.get(f"{API}/projects/{demo_project_id}/models")
        assert r.status_code == 200
        models = r.json()
        assert len(models) >= 1
        m = models[0]
        versions = m.get("versions") or []
        assert any(v.get("status") == "pret" for v in versions), f"no ready version, versions: {[v.get('status') for v in versions]}"

    def test_upload_duplicate_sha_409(self, admin, demo_project_id):
        if not SEED_IFC.exists():
            pytest.skip("seed IFC missing")
        models = admin.get(f"{API}/projects/{demo_project_id}/models").json()
        mid = models[0]["id"]
        with open(SEED_IFC, "rb") as f:
            files = {"file": ("Duplex_A.ifc", f, "application/octet-stream")}
            data = {"model_id": mid}
            r = admin.post(f"{API}/projects/{demo_project_id}/models", files=files, data=data)
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text[:200]}"

    def test_upload_to_new_project_succeeds(self, admin, test_project_id):
        if not SEED_IFC.exists():
            pytest.skip("seed IFC missing")
        with open(SEED_IFC, "rb") as f:
            files = {"file": ("Duplex_A.ifc", f, "application/octet-stream")}
            data = {"name": "TestModel", "discipline": "Architecture"}
            r = admin.post(f"{API}/projects/{test_project_id}/models", files=files, data=data)
        assert r.status_code == 201, r.text
        vid = r.json()["version"]["id"]
        final = None
        for _ in range(45):
            time.sleep(1)
            mv = admin.get(f"{API}/model-versions/{vid}")
            if mv.status_code == 200:
                final = mv.json().get("status")
                if final in ("pret", "echec"):
                    break
        assert final == "pret", f"final status: {final}"

    def test_upload_non_ifc_422(self, admin, test_project_id):
        files = {"file": ("not.txt", io.BytesIO(b"hello world"), "text/plain")}
        data = {"name": "BadModel", "discipline": "Architecture"}
        r = admin.post(f"{API}/projects/{test_project_id}/models", files=files, data=data)
        assert r.status_code == 422, f"got {r.status_code}: {r.text[:200]}"

    def test_upload_garbage_ifc_fails(self, admin, test_project_id):
        content = b"ISO-10303-21;\nblah blah not actually ifc\nENDSEC;\nEND-ISO-10303-21;\n"
        files = {"file": ("bad.ifc", io.BytesIO(content), "application/octet-stream")}
        data = {"name": "GarbageModel"}
        r = admin.post(f"{API}/projects/{test_project_id}/models", files=files, data=data)
        if r.status_code != 201:
            pytest.skip(f"upload rejected: {r.status_code}")
        vid = r.json()["version"]["id"]
        final = None
        for _ in range(30):
            time.sleep(1)
            mv = admin.get(f"{API}/model-versions/{vid}")
            if mv.status_code == 200:
                final = mv.json().get("status")
                if final in ("pret", "echec"):
                    break
        assert final == "echec", f"expected echec, got {final}"


# ---------- Links & rules ----------
class TestLinks:
    def test_list_links(self, admin, demo_project_id):
        r = admin.get(f"{API}/projects/{demo_project_id}/links")
        assert r.status_code == 200

    def test_rule_preview(self, admin, demo_project_id):
        models = admin.get(f"{API}/projects/{demo_project_id}/models").json()
        mid = models[0]["id"]
        body = {"model_id": mid, "filters": {"ifc_types": [], "storeys": ["Level 1"],
                                             "disciplines": [], "name_contains": "",
                                             "property_name": "", "property_value": ""}}
        r = admin.post(f"{API}/projects/{demo_project_id}/link-rules/preview", json=body)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "count" in data or "global_ids" in data


# ---------- Dashboard & Audit ----------
class TestDashboardAudit:
    def test_dashboard(self, admin, demo_project_id):
        r = admin.get(f"{API}/projects/{demo_project_id}/dashboard")
        assert r.status_code == 200

    def test_audit(self, admin, demo_project_id):
        r = admin.get(f"{API}/projects/{demo_project_id}/audit?limit=10")
        assert r.status_code == 200
