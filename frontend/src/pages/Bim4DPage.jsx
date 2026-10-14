import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Loading } from "@/components/common";
import IfcViewer from "@/components/bim/IfcViewer";
import Gantt from "@/components/gantt/Gantt";
import Timeline from "@/components/bim4d/Timeline";
import SidePanel from "@/components/bim4d/SidePanel";
import ReportDialog from "@/components/bim4d/ReportDialog";
import IssueCreateDialog from "@/components/issues/IssueCreateDialog";
import IssueSheet from "@/components/issues/IssueSheet";
import { useTaskFilters } from "@/pages/PlanningPage";
import { useElements, useIssuePins, useLinks, useModels, usePlanning, useProject } from "@/hooks/useProjectData";
import { errMsg } from "@/lib/api";
import { addDays, canLink, canWrite } from "@/lib/format";
import { PHASE_COLORS, computeElementPhases } from "@/lib/sim4d";

function useLinkMaps(links) {
  return useMemo(() => {
    const byGid = new Map(), byTask = new Map();
    (links || []).forEach((link) => {
      if (!byGid.has(link.global_id)) byGid.set(link.global_id, []);
      byGid.get(link.global_id).push(link.task_id);
      if (!byTask.has(link.task_id)) byTask.set(link.task_id, []);
      byTask.get(link.task_id).push(link.global_id);
    });
    return { byGid, byTask };
  }, [links]);
}

function phaseStyle(phase, ghost) {
  if (phase === "a_realiser") return { hex: PHASE_COLORS.a_realiser, ghost: ghost === "ghost", hide: ghost === "hide", opacity: 0.5 };
  if (phase === "hors_filtre") return { ghost: true };
  if (phase === "non_planifie") return { hex: 0xe2e8f0, opacity: 0.35 };
  return { hex: PHASE_COLORS[phase] };
}

/** Viewer colour map + per-phase counts for the legend. */
function buildColorMap(elements, phases, ghost) {
  const colorMap = new Map(), counts = {};
  elements.forEach((el) => {
    const phase = phases.get(el.global_id) || "non_planifie";
    counts[phase] = (counts[phase] || 0) + 1;
    colorMap.set(el.global_id, phaseStyle(phase, ghost));
  });
  return { colorMap, counts };
}

function dateRange(tasks) {
  const starts = tasks.map((task) => task.early_start).filter(Boolean).sort();
  const ends = tasks.map((task) => task.early_finish).filter(Boolean).sort();
  return starts.length ? { start: addDays(starts[0], -1), end: addDays(ends[ends.length - 1], 1) } : null;
}

export default function Bim4DPage() {
  const { pid } = useParams();
  const { data: project } = useProject(pid);
  const { data: plan, isLoading, error, refetch } = usePlanning(pid);
  const { data: models = [] } = useModels(pid);
  const [modelId, setModelId] = useState("");
  const model = models.find((m) => m.id === modelId) || models.find((m) => m.current_version_id);
  const vid = model?.current_version_id;
  const { data: elementsData } = useElements(vid);
  const elements = useMemo(() => elementsData || [], [elementsData]);
  const { data: links } = useLinks(pid, model?.id);
  const { byGid, byTask } = useLinkMaps(links);
  const tasks = useMemo(() => plan?.tasks || [], [plan]);
  const { filtered, ui, active } = useTaskFilters(tasks);
  const range = useMemo(() => dateRange(tasks), [tasks]);
  const today = plan?.today;
  const [simDate, setSimDate] = useState(null);
  const date = simDate || (today ? (range && today > range.end ? range.end : today) : null);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState("semaine");
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState("prevu");
  const [ghost, setGhost] = useState("ghost");
  const [taskId, setTaskId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [focus, setFocus] = useState(null);
  const [tab, setTab] = useState("activity");
  const [issueElement, setIssueElement] = useState(null);
  const [openIssue, setOpenIssue] = useState(null);
  const pins = useIssuePins(pid, model?.id);

  const visibleIds = useMemo(() => (active ? new Set(filtered.map((t) => t.id)) : null), [filtered, active]);
  const countsAt = useCallback((d) => buildColorMap(elements, computeElementPhases(tasks, byGid, d, mode, today, visibleIds), ghost).counts, [elements, tasks, byGid, mode, today, visibleIds, ghost]);
  const phases = useMemo(() => (date ? computeElementPhases(tasks, byGid, date, mode, today, visibleIds) : new Map()), [tasks, byGid, date, mode, today, visibleIds]);
  const { colorMap, counts } = useMemo(() => buildColorMap(elements, phases, ghost), [elements, phases, ghost]);
  const highlightIds = useMemo(() => new Set([...selected].flatMap((gid) => byGid.get(gid) || [])), [selected, byGid]);
  const task = tasks.find((t) => t.id === taskId);

  const selectTask = (t) => {
    setTaskId(t.id);
    const g = byTask.get(t.id) || [];
    setSelected(new Set(g));
    if (g.length) setFocus({ gids: g, k: Date.now() });
    setTab("activity");
  };
  const selectGids = (g) => { setSelected(new Set(g)); if (g.length) setFocus({ gids: g, k: Date.now() }); };
  const pick = useCallback((gid, add) => {
    setSelected((prev) => {
      if (!gid) return new Set();
      const next = new Set(add ? prev : []);
      if (add && next.has(gid)) next.delete(gid); else next.add(gid);
      return next;
    });
    if (gid) setTab("object");
  }, [setSelected, setTab]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={errMsg(error)} onRetry={refetch} />;
  if (!range) return <div className="p-8 text-sm text-slate-600">Aucune activité planifiée. <Link className="text-blue-700 underline" to={`/projects/${pid}/planning`}>Créez des activités</Link> pour lancer la simulation 4D.</div>;
  return (
    <div className="flex h-full min-h-[760px] flex-col" data-testid="bim4d-workspace">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <h1 className="mr-1 font-heading text-lg font-bold">Espace BIM 4D</h1>
        <select data-testid="bim4d-model-select" value={model?.id || ""} onChange={(e) => setModelId(e.target.value)} className="h-8 rounded-md border border-slate-300 px-2 text-xs">
          {!models.length && <option value="">Aucune maquette</option>}
          {models.map((m) => <option key={m.id} value={m.id} disabled={!m.current_version_id}>{m.name}{!m.current_version_id ? " (non traitée)" : ""}</option>)}
        </select>
        {ui}
        <select data-testid="bim4d-ghost-select" value={ghost} onChange={(e) => setGhost(e.target.value)} className="h-8 rounded-md border border-slate-300 px-2 text-xs">
          <option value="ghost">À réaliser : fantôme</option><option value="hide">À réaliser : masqué</option><option value="color">À réaliser : gris plein</option>
        </select>
        <ReportDialog pid={pid} range={range} mode={mode} modelName={model?.name || ""} setSimDate={setSimDate} countsAt={countsAt} disabled={!vid} />
        <span className="ml-auto text-[11px] text-slate-500" data-testid="bim4d-sync-state">{links ? `${links.length} liaisons persistées · ${byTask.size} activités liées` : "Chargement des liaisons…"}</span>
      </div>
      <div className="grid min-h-0 flex-[3] grid-cols-1 lg:grid-cols-[1fr_340px]">
        <IfcViewer className="min-h-[340px]" versionId={vid} elements={elements} colorMap={colorMap} selectedGids={selected} onPick={pick} focusRequest={focus} issuePins={pins} onOpenIssue={setOpenIssue} />
        <div className="min-h-[300px] border-l border-slate-200">
          <SidePanel pid={pid} modelId={model?.id} versionId={vid} tasks={tasks} elements={elements} task={task} selected={selected} linksByGid={byGid} linksByTask={byTask}
            simDate={date} today={plan.today} canLink={canLink(project?.my_role) && !!vid && project?.status !== "archive"} onSelectGids={selectGids}
            onTaskClick={(id) => { const t = tasks.find((x) => x.id === id); if (t) selectTask(t); }} onCreateIssue={canWrite(project?.my_role) ? setIssueElement : undefined} tab={tab} setTab={setTab} />
        </div>
      </div>
      <Timeline start={range.start} end={range.end} date={date} setDate={setSimDate} playing={playing} setPlaying={setPlaying} step={step} setStep={setStep}
        speed={speed} setSpeed={setSpeed} mode={mode} setMode={setMode} counts={counts} today={plan.today} />
      <div className="min-h-[220px] flex-[2]">
        <Gantt tasks={filtered} deps={plan.dependencies} zoom="week" selectedId={taskId} highlightIds={highlightIds} onSelect={selectTask} canEdit={false}
          simDate={date} today={plan.today} showCritical rowHeight={28} compact calendar={plan.calendar} />
      </div>
      <IssueCreateDialog pid={pid} open={!!issueElement} onClose={() => setIssueElement(null)} element={issueElement} modelId={model?.id} />
      <IssueSheet issueId={openIssue} pid={pid} onClose={() => setOpenIssue(null)} canEdit={canWrite(project?.my_role)} />
    </div>
  );
}
