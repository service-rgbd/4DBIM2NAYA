import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Loading, PageHeader } from "@/components/common";
import { useProject } from "@/hooks/useProjectData";
import { errMsg, put } from "@/lib/api";
import { canWrite, fmtD } from "@/lib/format";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function CalendarPage() {
  const { pid } = useParams();
  const qc = useQueryClient();
  const { data: p } = useProject(pid);
  const [cal, setCal] = useState(null);
  const [ex, setEx] = useState({ date: "", type: "ferie", label: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) setCal(p.calendar); }, [p]);
  if (!p || !cal) return <Loading />;
  const editable = canWrite(p.my_role);
  const toggle = (d) => setCal({ ...cal, working_days: cal.working_days.includes(d) ? cal.working_days.filter((x) => x !== d) : [...cal.working_days, d].sort() });
  const add = () => {
    if (!ex.date) return toast.error("Date requise");
    if (cal.exceptions.some((e) => e.date === ex.date)) return toast.error("Exception déjà définie pour cette date");
    setCal({ ...cal, exceptions: [...cal.exceptions, ex].sort((a, b) => a.date.localeCompare(b.date)) });
    setEx({ date: "", type: "ferie", label: "" });
  };
  const save = async () => {
    setBusy(true);
    try {
      await put(`/projects/${pid}/calendar`, cal);
      toast.success("Calendrier enregistré — planning recalculé");
      ["project", "tasks", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k, pid] }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8 fade-up">
      <PageHeader title="Calendrier de chantier" subtitle="Jours ouvrés et exceptions utilisés par le moteur de planification (durées et décalages en jours ouvrés).">
        {editable && <Button data-testid="calendar-save-btn" disabled={busy} onClick={save} className="bg-blue-700 hover:bg-blue-800">Enregistrer et recalculer</Button>}
      </PageHeader>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Jours ouvrés</div>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <button key={d} disabled={!editable} data-testid={`calendar-day-${i}`} onClick={() => toggle(i)} className={`w-14 rounded-md border py-2 text-sm font-semibold ${cal.working_days.includes(i) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500"}`}>{d}</button>
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Jours fériés, fermetures et exceptions</div>
        {editable && (
          <div className="mb-4 grid grid-cols-1 items-end gap-2 sm:grid-cols-[160px_160px_1fr_auto]">
            <Field label="Date"><Input data-testid="exception-date-input" type="date" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></Field>
            <Field label="Type"><select data-testid="exception-type-select" className="h-9 w-full rounded-md border px-2 text-sm" value={ex.type} onChange={(e) => setEx({ ...ex, type: e.target.value })}><option value="ferie">Non travaillé</option><option value="ouvre">Travaillé exceptionnellement</option></select></Field>
            <Field label="Libellé"><Input data-testid="exception-label-input" value={ex.label} onChange={(e) => setEx({ ...ex, label: e.target.value })} placeholder="ex. Congés BTP" /></Field>
            <Button data-testid="exception-add-btn" variant="secondary" onClick={add}>Ajouter</Button>
          </div>
        )}
        {cal.exceptions.map((e) => (
          <div key={e.date} className="flex items-center gap-3 border-b py-2 text-sm" data-testid={`exception-${e.date}`}>
            <span className="w-32 font-mono">{fmtD(e.date)}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${e.type === "ferie" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{e.type === "ferie" ? "Non travaillé" : "Travaillé"}</span>
            <span className="flex-1 text-slate-600">{e.label}</span>
            {editable && <button data-testid={`exception-delete-${e.date}`} onClick={() => setCal({ ...cal, exceptions: cal.exceptions.filter((x) => x.date !== e.date) })} className="text-red-600"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {!cal.exceptions.length && <div className="text-sm text-slate-500">Aucune exception.</div>}
      </div>
    </div>
  );
}
