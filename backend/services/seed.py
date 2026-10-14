"""Idempotent seeding: admin account, read-only test user and the clearly-labelled DEMO project."""
import os
from pathlib import Path
from core.db import db, fs, new_id, now_iso
from core.security import hash_password, verify_password
from services.planning import recompute

SEED_IFC = Path(__file__).parent.parent / "seed" / "Duplex_A.ifc"
WALLS = ["IFCWALLSTANDARDCASE", "IFCWALL"]

TASKS = [
    # code, name, lot, zone, company, start, duration, milestone
    ("A010", "Installation de chantier", "00 Installation", "Site", "BTP Durand", "2026-09-07", 5, False),
    ("A020", "Fondations — semelles", "01 Gros œuvre", "Fondations", "BTP Durand", "2026-09-07", 8, False),
    ("A030", "Murs de soubassement", "01 Gros œuvre", "Fondations", "BTP Durand", "2026-09-07", 6, False),
    ("A040", "Dalle RDC", "01 Gros œuvre", "Niveau 1", "BTP Durand", "2026-09-07", 5, False),
    ("A050", "Murs RDC", "01 Gros œuvre", "Niveau 1", "BTP Durand", "2026-09-07", 10, False),
    ("A060", "Poutres, escaliers et garde-corps RDC", "02 Structure secondaire", "Niveau 1", "Métal Concept", "2026-09-07", 4, False),
    ("A070", "Dalle R+1", "01 Gros œuvre", "Niveau 2", "BTP Durand", "2026-09-07", 5, False),
    ("A080", "Murs R+1", "01 Gros œuvre", "Niveau 2", "BTP Durand", "2026-09-07", 10, False),
    ("A090", "Poutres R+1", "02 Structure secondaire", "Niveau 2", "Métal Concept", "2026-09-07", 3, False),
    ("A100", "Charpente et couverture", "03 Couverture", "Toiture", "Toitures de l'Ouest", "2026-09-07", 8, False),
    ("J110", "Jalon : bâtiment hors d'eau", "Jalons", "Global", "", "2026-09-07", 0, True),
    ("A120", "Menuiseries extérieures", "04 Menuiseries", "Global", "Alu Fenêtres SA", "2026-09-07", 8, False),
    ("A130", "Portes intérieures", "05 Menuiseries int.", "Global", "Bois & Portes", "2026-09-07", 5, False),
    ("A140", "Revêtements de sols et plafonds", "06 Revêtements", "Global", "Finitions Martin", "2026-09-07", 8, False),
    ("A150", "Aménagement et mobilier", "07 Aménagement", "Global", "Agencement Pro", "2026-09-07", 5, False),
    ("J160", "Jalon : réception des travaux", "Jalons", "Global", "", "2026-09-07", 0, True),
]
DEPS = [("A010", "A020", "FS", 0), ("A020", "A030", "FS", 0), ("A030", "A040", "FS", 0), ("A040", "A050", "FS", 0),
        ("A050", "A060", "SS", 5), ("A050", "A070", "FS", 0), ("A070", "A080", "FS", 0), ("A080", "A090", "FF", 0),
        ("A080", "A100", "FS", 0), ("A100", "J110", "FS", 0), ("J110", "A120", "FS", 0), ("A120", "A130", "FS", 2),
        ("A130", "A140", "SS", 2), ("A140", "A150", "FS", 0), ("A150", "J160", "FS", 0), ("A060", "A070", "FS", 0)]
ACTUALS = {  # code: [(date, progress)], actual dates follow progress records
    "A010": [("2026-09-09", 50), ("2026-09-11", 100)],
    "A020": [("2026-09-18", 40), ("2026-09-25", 100)],
    "A030": [("2026-09-28", 10), ("2026-10-06", 40), ("2026-10-12", 60)],
}
RULES = [
    ("A020", "Semelles de fondation", {"ifc_types": ["IFCFOOTING"]}),
    ("A030", "Murs niveau T/FDN", {"ifc_types": WALLS, "storeys": ["T/FDN"]}),
    ("A040", "Dalles Level 1", {"ifc_types": ["IFCSLAB"], "storeys": ["Level 1"]}),
    ("A050", "Murs Level 1", {"ifc_types": WALLS, "storeys": ["Level 1"]}),
    ("A060", "Structure secondaire Level 1", {"ifc_types": ["IFCBEAM", "IFCMEMBER", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAILING"], "storeys": ["Level 1"]}),
    ("A070", "Dalles Level 2", {"ifc_types": ["IFCSLAB"], "storeys": ["Level 2"]}),
    ("A080", "Murs Level 2", {"ifc_types": WALLS, "storeys": ["Level 2"]}),
    ("A090", "Poutres Level 2", {"ifc_types": ["IFCBEAM"], "storeys": ["Level 2"]}),
    ("A100", "Toiture", {"storeys": ["Roof"], "ifc_types": ["IFCROOF", "IFCSLAB"] + WALLS}),
    ("A120", "Fenêtres", {"ifc_types": ["IFCWINDOW"]}),
    ("A130", "Portes", {"ifc_types": ["IFCDOOR"]}),
    ("A140", "Revêtements", {"ifc_types": ["IFCCOVERING"]}),
    ("A150", "Mobilier", {"ifc_types": ["IFCFURNISHINGELEMENT"]}),
]


async def _user(email: str, password: str, name: str, role: str) -> dict:
    existing = await db.users.find_one({"email": email})
    if not existing:
        u = {"id": new_id(), "email": email, "name": name, "role": role, "active": True, "password_hash": hash_password(password), "created_at": now_iso()}
        await db.users.insert_one(u)
        return u
    if not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password)}})
    return existing


async def seed() -> None:
    admin = await _user(os.environ["ADMIN_EMAIL"].lower(), os.environ["ADMIN_PASSWORD"], "Administrateur plateforme", "admin_plateforme")
    viewer = await _user(os.environ["VIEWER_EMAIL"].lower(), os.environ["VIEWER_PASSWORD"], "Observateur (lecture seule)", "utilisateur")
    if await db.projects.find_one({"reference": "DEMO-DUPLEX"}):
        return
    pid = new_id()
    await db.projects.insert_one({
        "id": pid, "reference": "DEMO-DUPLEX", "name": "Résidence Duplex — projet de démonstration", "is_demo": True,
        "description": "Projet DÉMO : planning fictif relié à la maquette publique « Duplex Apartment » (IFC2x3, buildingSMART/NIBS). Données non réelles.",
        "operation_type": "Construction neuve — logements", "address": "12 rue de l'Exemple, 44000 Nantes (fictive)",
        "client": "SCI Démo (fictif)", "architect": "Atelier Démo (fictif)", "start_planned": "2026-09-07", "end_planned": "2027-01-29",
        "budget_initial": None, "status": "actif", "manager": admin["name"], "created_by": admin["id"],
        "calendar": {"working_days": [0, 1, 2, 3, 4], "exceptions": [
            {"date": "2026-11-11", "type": "ferie", "label": "Armistice"}, {"date": "2026-12-25", "type": "ferie", "label": "Noël"},
            {"date": "2027-01-01", "type": "ferie", "label": "Jour de l'an"}]},
        "pending_seed_rules": [{"task_code": c, "name": n, "filters": f} for c, n, f in RULES],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None, "version": 1,
    })
    await db.project_members.insert_many([
        {"id": new_id(), "project_id": pid, "user_id": admin["id"], "role": "chef_projet", "created_at": now_iso()},
        {"id": new_id(), "project_id": pid, "user_id": viewer["id"], "role": "lecteur", "created_at": now_iso()},
    ])
    ids = {}
    for i, (code, name, lot, zone, company, start, dur, ms) in enumerate(TASKS):
        ids[code] = new_id()
        await db.tasks.insert_one({
            "id": ids[code], "project_id": pid, "code": code, "name": name, "description": "", "lot": lot, "zone": zone,
            "company": company, "responsible": "", "start": start, "duration": dur, "is_milestone": ms, "priority": "normale",
            "status": "a_faire", "progress": 0, "actual_start": None, "actual_end": None, "sort_order": i + 1, "version": 1,
            "created_by": "seed", "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None})
    for a, b, t, lag in DEPS:
        await db.dependencies.insert_one({"id": new_id(), "project_id": pid, "predecessor_id": ids[a], "successor_id": ids[b], "type": t, "lag": lag, "created_by": "seed", "created_at": now_iso()})
    for code, recs in ACTUALS.items():
        for d, p in recs:
            await db.progress_records.insert_one({"id": new_id(), "project_id": pid, "task_id": ids[code], "progress": p, "date": d, "comment": "Donnée de démonstration", "method": "pourcentage_saisi", "by": "seed", "created_at": now_iso()})
        last_d, last_p = recs[-1]
        await db.tasks.update_one({"id": ids[code]}, {"$set": {"progress": last_p, "actual_start": recs[0][0][:8] + {"A010": "07", "A020": "14", "A030": "28"}[code],
                                                                "actual_end": last_d if last_p == 100 else None, "status": "termine" if last_p == 100 else "en_cours"}})
    await recompute(pid)
    raw = SEED_IFC.read_bytes()
    import hashlib
    sha = hashlib.sha256(raw).hexdigest()
    mid = new_id()
    file_id = await fs.upload_from_stream(SEED_IFC.name, raw, metadata={"project_id": pid, "sha256": sha})
    await db.bim_models.insert_one({"id": mid, "project_id": pid, "name": "Duplex — Architecture (exemple public)", "discipline": "Architecture",
                                    "current_version_id": None, "created_by": "seed", "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None})
    await db.bim_versions.insert_one({"id": new_id(), "project_id": pid, "model_id": mid, "version_no": 1, "filename": SEED_IFC.name, "size": len(raw),
                                      "sha256": sha, "file_id": file_id, "status": "en_attente", "progress": 0, "stage": "En file d'attente",
                                      "attempts": 0, "error": None, "uploaded_by": "seed", "created_at": now_iso()})
