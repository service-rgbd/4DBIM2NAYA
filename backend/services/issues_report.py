"""Issues (réserves) PDF report: filtered list grouped by company, with site and closure-proof photos."""
import io
from datetime import datetime, timezone
from itertools import groupby
from xml.sax.saxutils import escape
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from services.report4d import NAVY, _fr, _grid

STATUS = {"ouvert": "Ouvert", "affecte": "Affecté", "en_cours": "En cours", "a_verifier": "À vérifier", "resolu": "Résolu", "cloture": "Clôturé"}
CATEGORY = {"reserve": "Réserve", "incident": "Incident", "non_conformite": "Non-conformité", "observation": "Observation"}
PRIO_COLOR = {"critique": "#DC2626", "haute": "#EA580C", "normale": "#2563EB", "basse": "#64748B"}
OPEN = ("ouvert", "affecte", "en_cours", "a_verifier")
NO_COMPANY = "Sans entreprise"
THUMB_W = 43 * mm


def thumbnail(raw: bytes, max_px: int = 700) -> bytes:
    img = PILImage.open(io.BytesIO(raw))
    img.thumbnail((max_px, max_px))
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=70)
    return out.getvalue()


def _t(text: str) -> str:
    return escape(text or "").replace("\n", "<br/>")


def _summary(groups: list, today: str) -> Table:
    rows = [["Entreprise", "Total", "Non levées", "À vérifier", "Résolues", "Clôturées", "Échéance dépassée"]]
    for company, items in groups:
        rows.append([company, len(items), sum(i["status"] in OPEN for i in items), sum(i["status"] == "a_verifier" for i in items),
                     sum(i["status"] == "resolu" for i in items), sum(i["status"] == "cloture" for i in items), sum(_overdue(i, today) for i in items)])
    return _grid([[str(c) for c in r] for r in rows], [62 * mm, 16 * mm, 22 * mm, 22 * mm, 20 * mm, 20 * mm, 24 * mm])


def _overdue(i: dict, today: str) -> bool:
    return bool(i.get("due_date") and i["status"] not in ("resolu", "cloture") and i["due_date"] < today)


def _photo_rows(photos: list, images: dict, label: str, st) -> list:
    cells = []
    for p in photos:
        raw = images.get(p["id"])
        if raw:
            cells.append([Image(io.BytesIO(raw), width=THUMB_W, height=32 * mm, kind="proportional"),
                          Paragraph(f"{label} · {_fr(p['at'][:10])}", st["small"])])
    if not cells:
        return []
    rows = [cells[k:k + 4] for k in range(0, len(cells), 4)]
    rows[-1] += [""] * (4 - len(rows[-1]))
    t = Table(rows, colWidths=[THUMB_W + 2 * mm] * 4, style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 1)])
    return [Paragraph(f"<b>Photos — {label.lower()}s ({len(cells)})</b>", st["small"]), t]


def _issue_block(i: dict, images: dict, today: str, st) -> list:
    color = PRIO_COLOR.get(i["priority"], "#64748B")
    head = Table([[Paragraph(f"<b>{i['reference']}</b>", st["hw"]), Paragraph(f"<b>{_t(i['title'])}</b>", st["hw"]),
                   Paragraph(f"<b>{i['priority'].upper()}</b>", st["hw"]), Paragraph(STATUS.get(i["status"], i["status"]), st["hw"])]],
                 colWidths=[24 * mm, 104 * mm, 24 * mm, 34 * mm],
                 style=[("BACKGROUND", (0, 0), (-1, -1), NAVY), ("BACKGROUND", (2, 0), (2, 0), colors.HexColor(color)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")])
    obj = f"{i.get('ifc_type', '')} · {i.get('element_name', '')}" if i.get("global_id") else "—"
    due = _fr(i.get("due_date")) + (" (dépassée)" if _overdue(i, today) else "")
    info = [["Catégorie", CATEGORY.get(i["category"], i["category"]), "Objet BIM", obj],
            ["Responsable", i.get("responsible") or "—", "Étage / zone", i.get("storey") or "—"],
            ["Échéance", due, "Créée le / par", f"{_fr(i['created_at'][:10])} · {i['created_by']}"]]
    details = Table([[Paragraph(c, st["small"]) for c in r] for r in info], colWidths=[24 * mm, 66 * mm, 28 * mm, 68 * mm],
                    style=[("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")), ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F1F5F9")),
                           ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F1F5F9"))])
    block = [head, details]
    if i.get("description"):
        block.append(Paragraph(f"<b>Constat :</b> {_t(i['description'])}", st["small"]))
    proof = i.get("resolution_note") or ""
    closed = f" — clôturée le {_fr(i['closed_at'][:10])}" if i.get("closed_at") else ""
    block.append(Paragraph(f"<b>Preuve de levée{closed} :</b> {_t(proof) if proof else '<i>aucune preuve enregistrée</i>'}", st["small"]))
    photos = i.get("photos", [])
    block += _photo_rows([p for p in photos if p["kind"] == "constat"], images, "Constat", st)
    block += _photo_rows([p for p in photos if p["kind"] == "preuve"], images, "Preuve", st)
    return [KeepTogether(block[:4]), *block[4:], Spacer(1, 6 * mm)]


def _styles():
    st = getSampleStyleSheet()
    st.add(st["Normal"].clone("small", fontSize=8, leading=10, spaceBefore=2))
    st.add(st["Normal"].clone("hw", fontSize=9, leading=11, textColor=colors.white))
    return st


def build_issues_report(project: dict, items: list, filters: dict, images: dict, today: str) -> bytes:
    buf = io.BytesIO()
    generated = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    st = _styles()
    items = sorted(items, key=lambda i: ((i.get("company") or NO_COMPANY).lower(), i["reference"]))
    groups = [(c, list(g)) for c, g in groupby(items, key=lambda i: i.get("company") or NO_COMPANY)]

    def footer(canvas, doc):
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(12 * mm, 7 * mm, f"{project['reference']} · Liste des réserves générée le {generated} · page {doc.page}")

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
                            title=f"Réserves {project['reference']}")
    demo = " — PROJET DE DÉMONSTRATION (données fictives)" if project.get("is_demo") else ""
    company = filters.get("company") or "Toutes (regroupées par entreprise)"
    story = [Paragraph(f"Liste des réserves{demo}", st["Title"]), Paragraph(f"<b>{_t(project['name'])}</b> — {project['reference']}", st["Heading2"]),
             Paragraph(f"Entreprise : <b>{_t(company)}</b> · Statut : {STATUS.get(filters.get('status'), 'tous')} · Priorité : {filters.get('priority') or 'toutes'}", st["Normal"]),
             Paragraph(f"Généré le {generated} · {len(items)} réserve(s)", st["Normal"]), Spacer(1, 5 * mm)]
    if not items:
        story.append(Paragraph("Aucune réserve ne correspond aux filtres sélectionnés.", st["Normal"]))
    else:
        story += [_summary(groups, today), PageBreak()]
        for k, (name, group) in enumerate(groups):
            story.append(Paragraph(f"Entreprise : {_t(name)} ({len(group)})", st["Heading2"]))
            for i in group:
                story += _issue_block(i, images, today, st)
            if k < len(groups) - 1:
                story.append(PageBreak())
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
