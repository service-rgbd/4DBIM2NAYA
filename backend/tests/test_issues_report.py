"""Backend tests for Réserves list PDF export + companies in list_issues."""
import io
import os
import pytest
import requests
import pymupdf

from pathlib import Path
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
            break
API = BASE_URL.rstrip("/") + "/api/v1"
PID = "009f00d0-0898-4581-8d69-3d58e8953b4d"
MID = "cac04e88-5011-4f96-b9c3-0b030e3a97fd"


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    _login(s, "admin@bim4d.fr", "Bim4D-Admin-2026")
    return s


@pytest.fixture(scope="module")
def lecteur():
    s = requests.Session()
    _login(s, "lecteur@bim4d.fr", "Bim4D-Lecteur-2026")
    return s


# ---- list_issues: companies ----
class TestCompaniesInListIssues:
    def test_companies_present_and_independent_of_filter(self, admin):
        r = admin.get(f"{API}/projects/{PID}/issues")
        assert r.status_code == 200
        data = r.json()
        assert "companies" in data
        companies_all = data["companies"]
        assert isinstance(companies_all, list)
        assert all(isinstance(c, str) and c for c in companies_all), "no empty strings"
        # Should contain the TEST seeded companies
        assert "TEST_Maçonnerie Durand" in companies_all
        assert "TEST_Plâtrerie Martin" in companies_all

        # Filter by one company: items must be filtered, but companies list must be independent
        r2 = admin.get(f"{API}/projects/{PID}/issues", params={"company": "TEST_Plâtrerie Martin"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["companies"] == companies_all, "companies must not change with filters"
        assert all(i["company"] == "TEST_Plâtrerie Martin" for i in d2["items"])


# ---- reports/issues PDF ----
class TestIssuesPdfReport:
    def test_admin_pdf_all_companies(self, admin):
        r = admin.get(f"{API}/projects/{PID}/reports/issues")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        with pymupdf.open(stream=r.content, filetype="pdf") as doc:
            text = "\n".join(p.get_text() for p in doc)
        # Grouped-by-company header
        assert "Toutes (regroupées par entreprise)" in text
        assert "TEST_Maçonnerie Durand" in text
        assert "TEST_Plâtrerie Martin" in text
        # Issues references
        for ref in ("RES-0001", "RES-0002", "RES-0003"):
            assert ref in text, f"{ref} missing in PDF"
        # Priority badges + status
        assert "CRITIQUE" in text
        # Save for debug
        with open("/app/test_reports/issues_all.pdf", "wb") as f:
            f.write(r.content)

    def test_admin_pdf_filtered_by_company(self, admin):
        r = admin.get(f"{API}/projects/{PID}/reports/issues", params={"company": "TEST_Plâtrerie Martin"})
        assert r.status_code == 200
        with pymupdf.open(stream=r.content, filetype="pdf") as doc:
            text = "\n".join(p.get_text() for p in doc)
        assert "TEST_Plâtrerie Martin" in text
        assert "TEST_Maçonnerie Durand" not in text
        # RES-0001 belongs to Maçonnerie Durand → must be absent
        assert "RES-0001" not in text
        assert "RES-0002" in text
        assert "RES-0003" in text
        with open("/app/test_reports/issues_one.pdf", "wb") as f:
            f.write(r.content)

    def test_admin_pdf_empty_result_is_valid(self, admin):
        r = admin.get(f"{API}/projects/{PID}/reports/issues", params={"company": "TEST_Entreprise_Inexistante_ZZZ"})
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"
        with pymupdf.open(stream=r.content, filetype="pdf") as doc:
            text = "\n".join(p.get_text() for p in doc)
        assert "Aucune réserve ne correspond" in text
        with open("/app/test_reports/issues_none.pdf", "wb") as f:
            f.write(r.content)

    def test_pdf_contains_photos_and_closure_proof(self, admin):
        # RES-0001 has 1 constat JPEG + 1 preuve PNG. Build a filtered PDF for its company.
        r = admin.get(f"{API}/projects/{PID}/reports/issues", params={"company": "TEST_Maçonnerie Durand"})
        assert r.status_code == 200
        with pymupdf.open(stream=r.content, filetype="pdf") as doc:
            text = "\n".join(p.get_text() for p in doc)
            # Count embedded images across pages
            images = sum(len(p.get_images(full=True)) for p in doc)
        # Section labels for photos (lowercased in template)
        assert "Photos — constats" in text or "constats (" in text
        assert "Photos — preuves" in text or "preuves (" in text
        # Preuve de levée line always present
        assert "Preuve de levée" in text
        # At least two images embedded (constat + preuve, each thumbnailed)
        assert images >= 2, f"Expected >=2 images, got {images}"

    def test_filter_by_priority_and_status(self, admin):
        r = admin.get(f"{API}/projects/{PID}/reports/issues", params={"priority": "critique"})
        assert r.status_code == 200
        with pymupdf.open(stream=r.content, filetype="pdf") as doc:
            text = "\n".join(p.get_text() for p in doc)
        assert "RES-0001" in text  # critique one
        assert "RES-0002" not in text  # basse

    def test_lecteur_cannot_export(self, lecteur):
        r = lecteur.get(f"{API}/projects/{PID}/reports/issues")
        assert r.status_code == 403, r.text
