"""4D simulation PDF report (reportlab): data from the database + viewer captures sent by the client."""
import base64
import io
from datetime import datetime, timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

MODE_LABEL = {"prevu": "Prévu (dates planifiées)", "reel": "Réel (dates constatées, sans extrapolation)", "ecart": "Écart prévu / réel"}
PHASES = [("a_realiser", "À réaliser", "#94A3B8"), ("en_cours", "En cours", "#3B82F6"), ("termine", "Terminé", "#10B981"),
          ("en_retard", "En retard", "#EF4444"), ("bloque", "Bloqué", "#F97316"), ("conforme", "Conforme", "#10B981"),
          ("en_avance", "En avance", "#8B5CF6"), ("non_planifie", "Non planifié", "#CBD5E1")]
NAVY = colors.HexColor("#1E3A8A")


def _fr(d: str) -> str:
    return f"{d[8:10]}/{d[5:7]}/{d[0:4]}" if d else "—"


def _grid(data: list, widths: list) -> Table:
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _cover(project: dict, dash: dict, mode: str, model_name: str, generated: str, st) -> list:
    k = dash["kpis"]
    demo = " — PROJET DE DÉMONSTRATION (données fictives)" if project.get("is_demo") else ""
    rows = [["Indicateur", "Valeur"], ["Avancement prévu au " + _fr(dash["today"]), f"{k['planned_progress']} %"],
            ["Avancement réel (saisi, pondéré par durée)", f"{k['actual_progress']} %"],
            ["Activités : total / terminées / en retard / bloquées", f"{k['tasks_total']} / {k['tasks_done']} / {k['tasks_delayed']} / {k['tasks_blocked']}"],
            ["Fin calculée (chemin critique)", _fr(dash.get("computed_finish"))], ["Liaisons objet-activité", str(dash["bim"]["links"])]]
    return [Paragraph(f"Rapport de simulation BIM 4D{demo}", st["Title"]),
            Paragraph(f"<b>{project['name']}</b> — {project['reference']}", st["Heading2"]),
            Paragraph(f"Maquette : {model_name or '—'} · Mode de simulation : {MODE_LABEL[mode]}", st["Normal"]),
            Paragraph(f"Généré le {generated} à partir des données enregistrées", st["Normal"]), Spacer(1, 6 * mm),
            _grid(rows, [120 * mm, 60 * mm]), PageBreak()]


def _capture_page(cap: dict, tasks: list, st) -> list:
    d = cap["date"]
    img = Image(io.BytesIO(base64.b64decode(cap["image"].split(",")[-1])), width=165 * mm, height=95 * mm, kind="proportional")
    counts = [[label, str(cap["counts"].get(key, 0))] for key, label, _ in PHASES if cap["counts"].get(key)]
    active = [[t["code"], t["name"][:60], t.get("company", ""), _fr(t["early_start"]), _fr(t["early_finish"]), f"{t.get('progress', 0)} %"]
              for t in tasks if t.get("early_start") and t["early_start"] <= d <= t["early_finish"]]
    side = _grid([["Phase", "Objets"]] + (counts or [["—", "0"]]), [38 * mm, 18 * mm])
    body = [Paragraph(f"État au {_fr(d)}", st["Heading2"]), Table([[img, side]], colWidths=[170 * mm, 60 * mm], style=[("VALIGN", (0, 0), (-1, -1), "TOP")]),
            Spacer(1, 3 * mm), Paragraph(f"Activités planifiées en cours à cette date ({len(active)})", st["Heading4"])]
    body.append(_grid([["Code", "Activité", "Entreprise", "Début prévu", "Fin prévue", "Avancement saisi"]] + active[:12],
                      [18 * mm, 95 * mm, 45 * mm, 28 * mm, 28 * mm, 30 * mm]) if active else Paragraph("Aucune activité planifiée en cours.", st["Normal"]))
    return body + [PageBreak()]


def build_report(project: dict, dash: dict, tasks: list, mode: str, model_name: str, captures: list) -> bytes:
    buf = io.BytesIO()
    generated = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    st = getSampleStyleSheet()

    def footer(canvas, doc):
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(12 * mm, 7 * mm, f"{project['reference']} · Rapport 4D généré le {generated} · page {doc.page}")

    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
                            title=f"Rapport 4D {project['reference']}")
    story = _cover(project, dash, mode, model_name, generated, st)
    for cap in sorted(captures, key=lambda c: c["date"]):
        story += _capture_page(cap, tasks, st)
    story.pop()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
