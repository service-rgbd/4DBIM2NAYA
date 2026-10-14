import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/common";
import Gantt from "@/components/gantt/Gantt";
import TaskSheet from "@/components/gantt/TaskSheet";
import MoveConfirmDialog from "@/components/gantt/MoveConfirmDialog";
import { useBaselines, usePlanning, useProject } from "@/hooks/useProjectData";
import { errMsg, post } from "@/lib/api";
import { HEALTH, canWrite } from "@/lib/format";

const sel = "h-8 rounded-md border border-slate-300 bg-white px-2 text-xs";
const HEALTH_OPTIONS = Object.entries(HEALTH).filter(([k]) => k !== "non_planifie");

export function useTaskFilters(tasks) {
  const [f, setF] = useState({ q: "", lot: "", company: "", zone: "", health: "" });
  const opts = useMemo(() => ({
    lot: [...new Set(tasks.map((t) => t.lot).filter(Boolean))].sort(),
    company: [...new Set(tasks.map((t) => t.company).filter(Boolean))].sort(),
    zone: [...new Set(tasks.map((t) => t.zone).filter(Boolean))].sort(),
  }), [tasks]);
  const filtered = useMemo(() => tasks.filter((t) => (!f.q || `${t.code} ${t.name}`.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.lot || t.lot === f.lot) && (!f.company || t.company === f.company) && (!f.zone || t.zone === f.zone) && (!f.health || t.health === f.health)), [tasks, f]);
  const active = !!(f.q || f.lot || f.company || f.zone || f.health);
  const ui = (
    <>
      <Input data-testid="filter-search" placeholder="Rechercher…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="h-8 w-40 text-xs" />
      {["lot", "company", "zone"].map((k) => (
        <select key={k} data-testid={`filter-${k}`} className={sel} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
          <option value="">{{ lot: "Tous lots", company: "Toutes entreprises", zone: "Toutes zones" }[k]}</option>
          {opts[k].map((o) => <option key={o}>{o}</option>)}
        </select>
      ))}
      <select data-testid="filter-health" className={sel} value={f.health} onChange={(e) => setF({ ...f, health: e.target.value })}>
        <option value="">Tous états</option>{HEALTH_OPTIONS.map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
      </select>
    </>
  );
  return { filtered, ui, active };
}

export default function PlanningPage() {
  const { pid } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { data: project } = useProject(pid);
  const { data, isLoading, error, refetch } = usePlanning(pid);
  const { data: baselines = [] } = useBaselines(pid);
  const [zoom, setZoom] = useState("week");
  const [critical, setCritical] = useState(true);
  const [baselineId, setBaselineId] = useState("");
  const [sheet, setSheet] = useState(null);
  const [move, setMove] = useState(null);
  const tasks = useMemo(() => data?.tasks || [], [data]);
  const { filtered, ui } = useTaskFilters(tasks);
  const role = project?.my_role;
  const editable = canWrite(role) && project?.status !== "archive";

  const hasTasks = tasks.length > 0;
  useEffect(() => {
    const tid = sp.get("task");
    if (tid && hasTasks) { setSheet(tid); setSp({}, { replace: true }); }
  }, [sp, setSp, setSheet, hasTasks]);

  const baseline = useMemo(() => {
    const b = baselines.find((x) => x.id === baselineId);
    return b ? new Map(b.tasks.map((t) => [t.task_id, t])) : null;
  }, [baselines, baselineId]);

  const saveBaseline = async () => {
    const name = window.prompt("Nom du planning de référence :", `Référence du ${new Date().toLocaleDateString("fr-FR")}`);
    if (!name) return;
    try {
      const b = await post(`/projects/${pid}/baselines`, { name });
      qc.invalidateQueries({ queryKey: ["baselines", pid] });
      setBaselineId(b.id);
      toast.success("Planning de référence enregistré");
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={errMsg(error)} onRetry={refetch} />;
  const current = tasks.find((t) => t.id === sheet);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <h1 className="mr-2 font-heading text-xl font-bold">Planning Gantt</h1>
        <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs font-semibold">
          {[["day", "Jour"], ["week", "Semaine"], ["month", "Mois"]].map(([k, l]) => <button key={k} data-testid={`zoom-${k}`} onClick={() => setZoom(k)} className={`px-2.5 py-1.5 ${zoom === k ? "bg-blue-700 text-white" : "bg-white hover:bg-slate-50"}`}>{l}</button>)}
        </div>
        {ui}
        <label className="flex items-center gap-1.5 text-xs"><input data-testid="toggle-critical" type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />Chemin critique</label>
        <select data-testid="baseline-select" className={sel} value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
          <option value="">Sans référence</option>{baselines.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {editable && <Button data-testid="save-baseline-btn" size="sm" variant="outline" onClick={saveBaseline}><Save className="mr-1.5 h-3.5 w-3.5" />Figer une référence</Button>}
          {editable && <Button data-testid="new-task-btn" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setSheet("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />Activité</Button>}
        </div>
      </div>
      <div className="flex items-center gap-4 border-b bg-slate-50 px-4 py-1.5 text-[11px] text-slate-500">
        <span>{filtered.length}/{tasks.length} activités</span>
        <span>Dates calculées (méthode du chemin critique, calendrier du projet, durées en jours ouvrés)</span>
        {editable ? <span>Glisser une barre pour déplacer · poignée droite pour la durée</span> : <span className="font-semibold text-amber-700">Lecture seule pour votre rôle</span>}
      </div>
      <div className="min-h-0 flex-1">
        <Gantt tasks={filtered} deps={data.dependencies} zoom={zoom} selectedId={sheet} onSelect={(t) => setSheet(t.id)} canEdit={editable}
          onDragEnd={(t, change) => setMove({ task: t, change: { start: change.start, ...(change.duration ? { duration: change.duration } : {}) } })}
          baseline={baseline} today={data.today} showCritical={critical} calendar={data.calendar} />
      </div>
      <TaskSheet open={!!sheet} onClose={() => setSheet(null)} task={sheet === "new" ? null : current} pid={pid} tasks={tasks} deps={data.dependencies} role={role} />
      <MoveConfirmDialog move={move} pid={pid} onClose={() => setMove(null)} />
    </div>
  );
}
