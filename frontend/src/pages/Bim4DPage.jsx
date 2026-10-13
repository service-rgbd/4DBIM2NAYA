import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Loading } from "@/components/common";
import IfcViewer from "@/components/bim/IfcViewer";
import Gantt from "@/components/gantt/Gantt";
import Timeline from "@/components/bim4d/Timeline";
import SidePanel from "@/components/bim4d/SidePanel";
import { useTaskFilters } from "@/pages/PlanningPage";
import { useElements, useLinks, useModels, usePlanning, useProject } from "@/hooks/useProjectData";
import { errMsg } from "@/lib/api";
import { addDays, canLink } from "@/lib/format";
import { PHASE_COLORS, computeElementPhases } from "@/lib/sim4d";

function useLinkMaps(links) {
  return useMemo(() => {
    const byGid = new Map(), byTask = new Map();
    (links || []).forEach((l) => {
      if (!byGid.has(l.global_id)) byGid.set(l.global_id, []);
      byGid.get(l.global_id).push(l.task_id);
      if (!byTask.has(l.task_id)) byTask.set(l.task_id, []);
      byTask.get(l.task_id).push(l.global_id);
    });
    return { byGid, byTask };
  }, [links]);
}

export default function Bim4DPage() {
  const { pid } = useParams();
  const { data: project } = useProject(pid);
  const { data: plan, isLoading, error, refetch } = usePlanning(pid);
  const { data: models = [] } = useModels(pid);
  const [modelId, setModelId] = useState("");
  const model = models.find((m) => m.id === modelId) || models.find((m) => m.current_version_id);
  const vid = model?.current_version_id;
  const { data: elements = [] } = useElements(vid);
  const { data: links } = useLinks(pid, model?.id);
  const { byGid, byTask } = useLinkMaps(links);
  const tasks = plan?.tasks || [];
  const { filtered, ui, active } = useTaskFilters(tasks);
  const range = useMemo(() => {
    const s = tasks.map((t) => t.early_start).filter(Boolean).sort();
    const e = tasks.map((t) => t.early_finish).filter(Boolean).sort();
    return s.length ? { start: addDays(s[0], -1), end: addDays(e[e.length - 1], 1) } : null;
  }, [tasks]);
  const [simDate, setSimDate] = useState(null);
  const date = simDate || (plan ? (range && plan.today > range.end ? range.end : plan.today) : null);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState("semaine");
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState("prevu");
  const [ghost, setGhost] = useState("ghost");
  const [taskId, setTaskId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [focus, setFocus] = useState(null);
  const [tab, setTab] = useState("activity");

  const visibleIds = useMemo(() => (active ? new Set(filtered.map((t) => t.id)) : null), [filtered, active]);
  const phases = useMemo(() => (date ? computeElementPhases(tasks, byGid, date, mode, plan?.today, visibleIds) : new Map()), [tasks, byGid, date, mode, plan?.today, visibleIds]);
  const { colorMap, counts } = useMemo(() => {
    const cm = new Map(), c = {};
    elements.forEach((e) => {
      const p = phases.get(e.global_id) || "non_planifie";
      c[p] = (c[p] || 0) + 1;
      if (p === "a_realiser") cm.set(e.global_id, { hex: PHASE_COLORS.a_realiser, ghost: ghost === "ghost", hide: ghost === "hide", opacity: 0.5 });
      else if (p === "hors_filtre") cm.set(e.global_id, { ghost: true });
      else if (p === "non_planifie") cm.set(e.global_id, { hex: 0xe2e8f0, opacity: 0.35 });
      else cm.set(e.global_id, { hex: PHASE_COLORS[p] });
    });
    return { colorMap: cm, counts: c };
  }, [elements, phases, ghost]);
  const highlightIds = useMemo(() => new Set([...selected].flatMap((g) => byGid.get(g) || [])), [selected, byGid]);
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
    setSelected((s) => { if (!gid) return new Set(); const n = new Set(add ? s : []); if (add && n.has(gid)) n.delete(gid); else n.add(gid); return n; });
    if (gid) setTab("object");
  }, []);

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
        <span className="ml-auto text-[11px] text-slate-500" data-testid="bim4d-sync-state">{links ? `${links.length} liaisons persistées · ${byTask.size} activités liées` : "Chargement des liaisons…"}</span>
      </div>
      <div className="grid min-h-0 flex-[3] grid-cols-1 lg:grid-cols-[1fr_340px]">
        <IfcViewer className="min-h-[340px]" versionId={vid} elements={elements} colorMap={colorMap} selectedGids={selected} onPick={pick} focusRequest={focus} />
        <div className="min-h-[300px] border-l border-slate-200">
          <SidePanel pid={pid} modelId={model?.id} versionId={vid} tasks={tasks} elements={elements} task={task} selected={selected} linksByGid={byGid} linksByTask={byTask}
            simDate={date} today={plan.today} canLink={canLink(project?.my_role) && !!vid && project?.status !== "archive"} onSelectGids={selectGids}
            onTaskClick={(id) => { const t = tasks.find((x) => x.id === id); if (t) selectTask(t); }} tab={tab} setTab={setTab} />
        </div>
      </div>
      <Timeline start={range.start} end={range.end} date={date} setDate={setSimDate} playing={playing} setPlaying={setPlaying} step={step} setStep={setStep}
        speed={speed} setSpeed={setSpeed} mode={mode} setMode={setMode} counts={counts} today={plan.today} />
      <div className="min-h-[220px] flex-[2]">
        <Gantt tasks={filtered} deps={plan.dependencies} zoom="week" selectedId={taskId} highlightIds={highlightIds} onSelect={selectTask} canEdit={false}
          simDate={date} today={plan.today} showCritical rowHeight={28} compact calendar={plan.calendar} />
      </div>
    </div>
  );
}
