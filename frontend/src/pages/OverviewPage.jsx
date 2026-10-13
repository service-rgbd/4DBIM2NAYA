import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DemoBadge, ErrorState, HealthBadge, Kpi, Loading, PageHeader } from "@/components/common";
import { useDashboard, useProject } from "@/hooks/useProjectData";
import { errMsg, post } from "@/lib/api";
import { PROJECT_STATUS, fmtD, fmtShort } from "@/lib/format";

function StatusControl({ project }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const change = async (status) => {
    if (!status) return;
    const reason = window.prompt(`Motif du passage au statut « ${PROJECT_STATUS[status]} » (tracé dans l'historique) :`, "") ?? null;
    if (reason === null) return;
    setBusy(true);
    try {
      await post(`/projects/${project.id}/status`, { status, reason });
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <select data-testid="project-status-select" disabled={busy || !project.allowed_transitions.length} value="" onChange={(e) => change(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
      <option value="">Statut : {PROJECT_STATUS[project.status]}</option>
      {project.allowed_transitions.map((s) => <option key={s} value={s}>→ {PROJECT_STATUS[s]}</option>)}
    </select>
  );
}

const List = ({ title, items, empty, testid }) => (
  <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid={testid}>
    <div className="border-b px-4 py-2.5 font-heading text-sm font-semibold text-slate-800">{title}</div>
    {items.length === 0 && <div className="px-4 py-4 text-xs text-slate-500">{empty}</div>}
    {items.map((t) => (
      <div key={t.id} className="flex items-center gap-3 border-b px-4 py-2 text-xs last:border-0">
        <span className="w-12 font-mono text-slate-500">{t.code}</span><span className="flex-1 truncate font-medium">{t.name}</span>
        <span className="font-mono text-slate-500">{fmtShort(t.early_finish)}</span><HealthBadge value={t.health} />
      </div>
    ))}
  </div>
);

export default function OverviewPage() {
  const { pid } = useParams();
  const { data: p } = useProject(pid);
  const { data: d, isLoading, error, refetch } = useDashboard(pid);
  if (isLoading || !p) return <Loading />;
  if (error) return <ErrorState message={errMsg(error)} onRetry={refetch} />;
  const k = d.kpis;
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8 fade-up">
      <PageHeader title={<span className="flex items-center gap-3">{p.name}{p.is_demo && <DemoBadge />}</span>} subtitle={`${p.reference} · ${p.operation_type} · ${p.address || "adresse non renseignée"}`}>
        <StatusControl project={p} />
        <Link to={`/projects/${pid}/4d`}><Button data-testid="overview-open-4d-btn" className="bg-blue-700 hover:bg-blue-800"><Clock3 className="mr-2 h-4 w-4" />Ouvrir l'espace 4D</Button></Link>
      </PageHeader>
      {p.is_demo && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900" data-testid="demo-notice">{p.description}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi testid="kpi-planned" label="Avancement prévu" value={`${k.planned_progress} %`} sub={`au ${fmtD(d.today)}`} />
        <Kpi testid="kpi-actual" label="Avancement réel" value={`${k.actual_progress} %`} tone={k.actual_progress < k.planned_progress ? "text-red-600" : "text-emerald-600"} sub="pondéré par durée" />
        <Kpi testid="kpi-delayed" label="En retard" value={k.tasks_delayed} tone={k.tasks_delayed ? "text-red-600" : ""} sub={`${k.tasks_blocked} bloquée(s)`} />
        <Kpi testid="kpi-progress" label="En cours / terminées" value={`${k.tasks_in_progress} / ${k.tasks_done}`} sub={`${k.tasks_total} activités`} />
        <Kpi testid="kpi-finish" label="Fin calculée" value={fmtShort(d.computed_finish)} sub={`prévue initialement ${fmtShort(p.end_planned)}`} />
        <Kpi testid="kpi-bim" label="Liaisons BIM" value={d.bim.links} sub={`${d.bim.tasks_unlinked} activité(s) sans objet`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="s-curve">
          <div className="mb-2 font-heading text-sm font-semibold">Courbe en S — avancement cumulé prévu vs réel</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <LineChart data={d.s_curve}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={fmtShort} tick={{ fontSize: 10 }} />
                <YAxis unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip labelFormatter={fmtD} />
                <Legend />
                <Line type="monotone" dataKey="prevu" name="Prévu" stroke="#94a3b8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="reel" name="Réel (relevés)" stroke="#1d4ed8" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <List testid="list-delayed" title="Activités en retard" items={[...d.delayed, ...d.blocked]} empty="Aucun retard détecté." />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <List testid="list-upcoming" title="Prochaines échéances" items={d.upcoming} empty="Aucune échéance." />
        <List testid="list-milestones" title="Jalons" items={d.milestones} empty="Aucun jalon." />
      </div>
    </div>
  );
}
