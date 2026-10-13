import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Link2Off, MousePointerClick, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HealthBadge } from "@/components/common";
import PropertiesPanel from "@/components/bim/PropertiesPanel";
import RuleDialog from "@/components/bim4d/RuleDialog";
import { del, errMsg, get, post } from "@/lib/api";
import { fmtD, fmtDT } from "@/lib/format";
import { PHASE_COLORS, PHASE_LABELS, plannedPhase, actualPhase } from "@/lib/sim4d";
import { invalidatePlanning } from "@/hooks/useProjectData";

function TaskInfo({ task, simDate, today, linkedCount, onSelectObjects }) {
  if (!task) return <div className="p-4 text-xs text-slate-500">Sélectionnez une activité dans le Gantt pour voir ses objets dans la maquette.</div>;
  const rows = [["Lot", task.lot], ["Zone", task.zone], ["Entreprise", task.company], ["Prévu", `${fmtD(task.early_start)} → ${fmtD(task.early_finish)}`],
    ["Réel", `${fmtD(task.actual_start)} → ${fmtD(task.actual_end)}`], ["Avancement saisi", `${task.progress || 0} %`], ["Marge totale", `${task.total_float} j${task.is_critical ? " (critique)" : ""}`]];
  const pp = plannedPhase(task, simDate), ap = actualPhase(task, simDate, today);
  return (
    <div className="space-y-3 p-3 text-xs" data-testid="activity-info">
      <div className="font-heading text-sm font-semibold">{task.code} · {task.name}</div>
      <HealthBadge value={task.health} />
      <table className="w-full"><tbody>{rows.map(([k, v]) => <tr key={k} className="border-b border-slate-100"><td className="w-32 py-1 text-slate-500">{k}</td><td className="font-mono">{v || "—"}</td></tr>)}</tbody></table>
      <div className="rounded-md bg-slate-50 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">État au {fmtD(simDate)}</div>
        <div className="flex gap-3" data-testid="activity-phase-at-date">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLORS[pp] }} />Prévu : {PHASE_LABELS[pp]}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLORS[ap] }} />Réel : {PHASE_LABELS[ap]}</span>
        </div>
      </div>
      <Button data-testid="activity-select-objects-btn" size="sm" variant="outline" onClick={onSelectObjects} disabled={!linkedCount}><MousePointerClick className="mr-1.5 h-3.5 w-3.5" />Sélectionner ses {linkedCount} objet(s)</Button>
    </div>
  );
}

function Rules({ pid, tasks }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["rules", pid], queryFn: () => get(`/projects/${pid}/link-rules`) });
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const remove = async (r) => {
    const withLinks = window.confirm(`Supprimer la règle « ${r.name} ».\nOK = retirer aussi les liaisons créées par cette règle\nAnnuler = conserver les liaisons`);
    try {
      const res = await del(`/link-rules/${r.id}`, { remove_links: withLinks });
      toast.success(`Règle supprimée (${res.removed} liaison(s) retirée(s))`);
      qc.invalidateQueries({ queryKey: ["rules", pid] }); qc.invalidateQueries({ queryKey: ["links", pid] }); invalidatePlanning(qc, pid);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-1 p-2 text-xs" data-testid="rules-list">
      {data.map((r) => (
        <div key={r.id} className="rounded border border-slate-200 p-2">
          <div className="flex items-center gap-2"><b className="flex-1 truncate">{r.name}</b><span className="font-mono">{r.matched_count} obj.</span><button data-testid={`rule-delete-${r.id}`} onClick={() => remove(r)} className="text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></div>
          <div className="text-slate-500">→ {byId[r.task_id]?.code} {byId[r.task_id]?.name}</div>
          <div className="font-mono text-[10px] text-slate-400">{Object.entries(r.filters).filter(([, v]) => v && v.length).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`).join(" · ")} · {fmtDT(r.created_at)}</div>
        </div>
      ))}
      {!data.length && <div className="p-2 text-slate-500">Aucune règle enregistrée.</div>}
    </div>
  );
}

function Unlinked({ elements, linksByGid, onSelect }) {
  const un = elements.filter((e) => !linksByGid.has(e.global_id));
  const byType = {};
  un.forEach((e) => { (byType[e.ifc_type] = byType[e.ifc_type] || []).push(e.global_id); });
  return (
    <div className="space-y-1 p-2 text-xs" data-testid="unlinked-list">
      <div className="px-1 pb-1 text-slate-600"><b data-testid="unlinked-count">{un.length}</b> objet(s) sur {elements.length} sans activité</div>
      {Object.entries(byType).sort((a, b) => b[1].length - a[1].length).map(([t, g]) => (
        <button key={t} data-testid={`unlinked-type-${t}`} onClick={() => onSelect(g)} className="flex w-full justify-between rounded border border-slate-200 px-2 py-1 hover:bg-amber-50"><span>{t}</span><span className="font-mono">{g.length}</span></button>
      ))}
    </div>
  );
}

export default function SidePanel({ pid, modelId, versionId, tasks, elements, task, selected, linksByGid, linksByTask, simDate, today, canLink, onSelectGids, onTaskClick, tab, setTab }) {
  const qc = useQueryClient();
  const sel = [...selected];
  const inTask = task ? sel.filter((g) => (linksByGid.get(g) || []).includes(task.id)) : [];
  const act = async (remove) => {
    try {
      if (remove) {
        const r = await post(`/projects/${pid}/links/remove`, { task_id: task.id, model_id: modelId, global_ids: inTask });
        toast.success(`${r.removed} liaison(s) retirée(s) de ${task.code}`);
      } else {
        const r = await post(`/projects/${pid}/links`, { task_id: task.id, model_id: modelId, global_ids: sel });
        toast.success(`${r.created} objet(s) IFC lié(s) à ${task.code}${r.already_linked ? ` (${r.already_linked} déjà liés)` : ""}`);
      }
      qc.invalidateQueries({ queryKey: ["links", pid] });
      invalidatePlanning(qc, pid);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="flex h-full flex-col bg-white">
      {canLink && (
        <div className="space-y-2 border-b p-2" data-testid="link-actions">
          <div className="text-[11px] text-slate-600"><b data-testid="selection-count">{sel.length}</b> objet(s) sélectionné(s) · activité : <b data-testid="selected-task-code">{task ? task.code : "aucune"}</b></div>
          <div className="flex flex-wrap gap-1.5">
            <Button data-testid="link-selection-btn" size="sm" disabled={!task || !sel.length || task.is_milestone} onClick={() => act(false)} className="bg-blue-700 hover:bg-blue-800"><Link2 className="mr-1 h-3.5 w-3.5" />Lier</Button>
            <Button data-testid="unlink-selection-btn" size="sm" variant="outline" disabled={!inTask.length} onClick={() => act(true)}><Link2Off className="mr-1 h-3.5 w-3.5" />Délier ({inTask.length})</Button>
            <RuleDialog pid={pid} modelId={modelId} versionId={versionId} tasks={tasks} defaultTaskId={task?.id} onPreviewSelect={onSelectGids} />
          </div>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="m-2 grid grid-cols-4">
          <TabsTrigger value="activity" data-testid="panel-tab-activity" className="text-xs">Activité</TabsTrigger>
          <TabsTrigger value="object" data-testid="panel-tab-object" className="text-xs">Objet</TabsTrigger>
          <TabsTrigger value="rules" data-testid="panel-tab-rules" className="text-xs">Règles</TabsTrigger>
          <TabsTrigger value="unlinked" data-testid="panel-tab-unlinked" className="text-xs">Non liés</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <TabsContent value="activity" className="mt-0"><TaskInfo task={task} simDate={simDate} today={today} linkedCount={task ? (linksByTask.get(task.id) || []).length : 0} onSelectObjects={() => onSelectGids(linksByTask.get(task.id) || [])} /></TabsContent>
          <TabsContent value="object" className="mt-0">{sel.length > 1 ? <div className="p-3 text-xs text-slate-600">{sel.length} objets sélectionnés. Sélectionnez un seul objet pour ses propriétés.</div> : <PropertiesPanel versionId={versionId} gid={sel[0]} onTaskClick={onTaskClick} />}</TabsContent>
          <TabsContent value="rules" className="mt-0"><Rules pid={pid} tasks={tasks} /></TabsContent>
          <TabsContent value="unlinked" className="mt-0"><Unlinked elements={elements} linksByGid={linksByGid} onSelect={onSelectGids} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
