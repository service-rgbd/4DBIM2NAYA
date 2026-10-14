import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, HealthBadge } from "@/components/common";
import { del, errMsg, get, patch, post } from "@/lib/api";
import { TASK_STATUS, DEP_TYPES, fmtD, fmtDT, iso } from "@/lib/format";
import { invalidatePlanning } from "@/hooks/useProjectData";

const schema = z.object({
  name: z.string().min(2, "2 caractères minimum").max(200),
  code: z.string().max(30).optional(),
  lot: z.string().max(80), zone: z.string().max(80), company: z.string().max(120), responsible: z.string().max(120),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date requise"),
  duration: z.coerce.number().int().min(0).max(2000),
  is_milestone: z.boolean(), priority: z.enum(["basse", "normale", "haute", "critique"]),
  status: z.enum(["a_planifier", "a_faire", "en_cours", "bloque", "termine", "annule"]),
  description: z.string().max(4000), exception_reason: z.string().max(500).optional(),
});
const sel = "h-9 w-full rounded-md border border-input bg-white px-2 text-sm";

function DetailsForm({ task, pid, onDone }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: task ? { ...task, exception_reason: "" } : { name: "", code: "", lot: "", zone: "", company: "", responsible: "", start: iso(new Date()), duration: 5, is_milestone: false, priority: "normale", status: "a_faire", description: "" },
  });
  const status = watch("status");
  const submit = async (v) => {
    try {
      if (task) {
        const body = { ...v, version: task.version };
        if (!body.exception_reason) delete body.exception_reason;
        await patch(`/tasks/${task.id}`, body);
        toast.success("Activité enregistrée — planning recalculé");
      } else {
        const { exception_reason, ...rest } = v;
        await post(`/projects/${pid}/tasks`, { ...rest, code: rest.code || null });
        toast.success("Activité créée");
      }
      invalidatePlanning(qc, pid);
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-3" data-testid="task-form">
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="Code"><Input data-testid="task-code-input" {...register("code")} placeholder="auto" /></Field>
        <Field label="Intitulé *" error={errors.name?.message}><Input data-testid="task-name-input" {...register("name")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lot"><Input data-testid="task-lot-input" {...register("lot")} /></Field>
        <Field label="Zone"><Input data-testid="task-zone-input" {...register("zone")} /></Field>
        <Field label="Entreprise"><Input data-testid="task-company-input" {...register("company")} /></Field>
        <Field label="Responsable"><Input data-testid="task-responsible-input" {...register("responsible")} /></Field>
        <Field label="Début au plus tôt (contrainte)" error={errors.start?.message}><Input data-testid="task-start-input" type="date" {...register("start")} /></Field>
        <Field label="Durée (jours ouvrés)" error={errors.duration?.message}><Input data-testid="task-duration-input" type="number" min={0} {...register("duration")} /></Field>
        <Field label="Priorité"><select data-testid="task-priority-select" className={sel} {...register("priority")}>{["basse", "normale", "haute", "critique"].map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
        <Field label="Statut"><select data-testid="task-status-select" className={sel} {...register("status")}>{Object.entries(TASK_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input data-testid="task-milestone-checkbox" type="checkbox" {...register("is_milestone")} />Jalon (durée nulle)</label>
      {task && status === "termine" && task.status !== "termine" && (task.progress || 0) < 100 && (
        <Field label="Justification d'exception (avancement < 100 %)"><Input data-testid="task-exception-input" {...register("exception_reason")} /></Field>
      )}
      <Field label="Description"><Textarea data-testid="task-description-input" rows={3} {...register("description")} /></Field>
      <Button data-testid="task-save-btn" type="submit" disabled={isSubmitting} className="w-full bg-blue-700 hover:bg-blue-800">{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{task ? "Enregistrer" : "Créer l'activité"}</Button>
    </form>
  );
}

function ProgressTab({ task, pid, canProgress }) {
  const qc = useQueryClient();
  const { data: recs = [] } = useQuery({ queryKey: ["progress", task.id], queryFn: () => get(`/tasks/${task.id}/progress`) });
  const [v, setV] = useState({ progress: task.progress || 0, date: iso(new Date()), comment: "" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/tasks/${task.id}/progress`, { ...v, progress: Number(v.progress) });
      toast.success("Avancement enregistré");
      invalidatePlanning(qc, pid);
      qc.invalidateQueries({ queryKey: ["progress", task.id] });
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-3 text-xs">
        <div><div className="text-slate-500">Début réel</div><div className="font-mono font-semibold">{fmtD(task.actual_start)}</div></div>
        <div><div className="text-slate-500">Fin réelle</div><div className="font-mono font-semibold">{fmtD(task.actual_end)}</div></div>
        <div><div className="text-slate-500">Avancement</div><div className="font-mono font-semibold" data-testid="task-progress-value">{task.progress || 0} %</div></div>
      </div>
      {canProgress && (
        <form onSubmit={save} className="space-y-3 rounded-md border p-3" data-testid="progress-form">
          <div className="text-xs text-slate-500">Méthode : pourcentage saisi par un responsable autorisé (le temps écoulé n'est jamais converti en avancement).</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Avancement (%)"><Input data-testid="progress-input" type="number" min={0} max={100} value={v.progress} onChange={(e) => setV({ ...v, progress: e.target.value })} /></Field>
            <Field label="Date constatée"><Input data-testid="progress-date-input" type="date" max={iso(new Date())} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          </div>
          <Field label="Commentaire"><Input data-testid="progress-comment-input" value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} /></Field>
          <Button data-testid="progress-save-btn" disabled={busy} type="submit" size="sm" className="bg-blue-700 hover:bg-blue-800">Enregistrer l'avancement</Button>
        </form>
      )}
      <div className="space-y-1">
        {recs.map((r) => <div key={r.id} className="flex justify-between border-b py-1.5 text-xs"><span className="font-mono">{fmtD(r.date)}</span><span className="font-mono font-semibold">{r.progress} %</span><span className="w-40 truncate text-slate-500">{r.by} {r.comment && `· ${r.comment}`}</span></div>)}
        {!recs.length && <div className="text-xs text-slate-500">Aucun relevé d'avancement.</div>}
      </div>
    </div>
  );
}

function DepsTab({ task, pid, tasks, deps, canEdit }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ predecessor_id: "", type: "FS", lag: 0 });
  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);
  const mine = useMemo(() => deps.filter((d) => d.successor_id === task.id || d.predecessor_id === task.id), [deps, task]);
  const candidates = useMemo(() => tasks.filter((t) => t.id !== task.id), [tasks, task]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await post(`/projects/${pid}/dependencies`, { ...f, lag: Number(f.lag), successor_id: task.id });
      toast.success("Dépendance ajoutée — planning recalculé");
      invalidatePlanning(qc, pid);
    } catch (err) { toast.error(errMsg(err)); }
  };
  const remove = async (id) => {
    try { await del(`/dependencies/${id}`); invalidatePlanning(qc, pid); toast.success("Dépendance supprimée"); } catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <div className="space-y-4">
      {mine.map((d) => {
        const pred = d.successor_id === task.id;
        const o = byId[pred ? d.predecessor_id : d.successor_id];
        return (
          <div key={d.id} className="flex items-center gap-2 border-b py-1.5 text-xs" data-testid={`dep-item-${o?.code}`}>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${pred ? "bg-slate-100" : "bg-blue-50 text-blue-700"}`}>{pred ? "Prédécesseur" : "Successeur"}</span>
            <span className="flex-1 truncate">{o?.code} {o?.name}</span>
            <span className="font-mono">{d.type}{d.lag ? ` ${d.lag > 0 ? "+" : ""}${d.lag}j` : ""}</span>
            {canEdit && <button data-testid={`dep-delete-${o?.code}`} onClick={() => remove(d.id)} className="text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        );
      })}
      {!mine.length && <div className="text-xs text-slate-500">Aucune dépendance.</div>}
      {canEdit && (
        <form onSubmit={add} className="space-y-2 rounded-md border p-3" data-testid="dep-form">
          <Field label="Prédécesseur"><select data-testid="dep-predecessor-select" required className={sel} value={f.predecessor_id} onChange={(e) => setF({ ...f, predecessor_id: e.target.value })}>
            <option value="">— choisir —</option>{candidates.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}</option>)}
          </select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type"><select data-testid="dep-type-select" className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(DEP_TYPES).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></Field>
            <Field label="Décalage (j ouvrés)"><Input data-testid="dep-lag-input" type="number" value={f.lag} onChange={(e) => setF({ ...f, lag: e.target.value })} /></Field>
          </div>
          <Button data-testid="dep-add-btn" size="sm" type="submit" variant="secondary">Ajouter la dépendance</Button>
        </form>
      )}
    </div>
  );
}

function HistoryTab({ task }) {
  const { data = [] } = useQuery({ queryKey: ["history", task.id, task.version], queryFn: () => get(`/tasks/${task.id}/history`) });
  return (
    <div className="space-y-2" data-testid="task-history">
      {data.map((h) => (
        <div key={h.id} className="border-b pb-2 text-xs">
          <div className="flex justify-between text-slate-500"><span>{h.user_email}</span><span className="font-mono">{fmtDT(h.at)}</span></div>
          <div className="text-slate-800">{h.summary}</div>
          {h.after && Object.keys(h.after).filter((k) => k !== "global_ids").map((k) => <div key={k} className="font-mono text-[10px] text-slate-500">{k} : {String(h.before?.[k] ?? "—")} → {String(h.after[k])}</div>)}
        </div>
      ))}
      {!data.length && <div className="text-xs text-slate-500">Aucun historique.</div>}
    </div>
  );
}

const SheetSummary = ({ task }) => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
    <HealthBadge value={task.health} testid="task-sheet-health" />
    <span className="font-mono">{fmtD(task.early_start)} → {fmtD(task.early_finish)}</span>
    <span>Marge : {task.total_float} j</span>
    {task.is_critical && <span className="font-semibold text-red-600">Chemin critique</span>}
    <span>{task.link_count || 0} objet(s) BIM</span>
  </div>
);

function SheetActions({ task, pid, onClose }) {
  const qc = useQueryClient();
  const action = async (kind) => {
    try {
      if (kind === "dup") { await post(`/tasks/${task.id}/duplicate`); toast.success("Activité dupliquée"); }
      else { if (!window.confirm(`Supprimer ${task.code} ? Ses dépendances et liaisons BIM seront retirées (suppression logique tracée).`)) return; await del(`/tasks/${task.id}`); toast.success("Activité supprimée"); onClose(); }
      invalidatePlanning(qc, pid);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="mt-3 flex gap-2">
      <Button data-testid="task-duplicate-btn" size="sm" variant="outline" onClick={() => action("dup")}><Copy className="mr-1 h-3.5 w-3.5" />Dupliquer</Button>
      <Button data-testid="task-delete-btn" size="sm" variant="outline" className="text-red-600" onClick={() => action("del")}><Trash2 className="mr-1 h-3.5 w-3.5" />Supprimer</Button>
    </div>
  );
}

const TaskTabs = ({ task, pid, tasks, deps, canEdit, canProgress }) => (
  <Tabs defaultValue="details" className="mt-4">
    <TabsList className="grid w-full grid-cols-4">
      <TabsTrigger value="details" data-testid="task-tab-details">Détails</TabsTrigger>
      <TabsTrigger value="progress" data-testid="task-tab-progress">Avancement</TabsTrigger>
      <TabsTrigger value="deps" data-testid="task-tab-deps">Liens</TabsTrigger>
      <TabsTrigger value="history" data-testid="task-tab-history">Historique</TabsTrigger>
    </TabsList>
    <TabsContent value="details">{canEdit ? <DetailsForm key={task.version} task={task} pid={pid} /> : <div className="text-sm text-slate-500">Lecture seule pour votre rôle.</div>}</TabsContent>
    <TabsContent value="progress"><ProgressTab task={task} pid={pid} canProgress={canProgress} /></TabsContent>
    <TabsContent value="deps"><DepsTab task={task} pid={pid} tasks={tasks} deps={deps} canEdit={canEdit} /></TabsContent>
    <TabsContent value="history"><HistoryTab task={task} /></TabsContent>
  </Tabs>
);

export default function TaskSheet({ open, onClose, task, pid, tasks, deps, role }) {
  const canEdit = ["admin_plateforme", "chef_projet", "bim_manager", "conducteur_travaux"].includes(role);
  const canProgress = canEdit || role === "sous_traitant";
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="task-sheet">
        <SheetHeader>
          <SheetTitle className="font-heading">{task ? `${task.code} · ${task.name}` : "Nouvelle activité"}</SheetTitle>
          {task && <SheetSummary task={task} />}
        </SheetHeader>
        {task && canEdit && <SheetActions task={task} pid={pid} onClose={onClose} />}
        {task ? <TaskTabs task={task} pid={pid} tasks={tasks} deps={deps} canEdit={canEdit} canProgress={canProgress} /> : <div className="mt-4"><DetailsForm pid={pid} onDone={onClose} /></div>}
      </SheetContent>
    </Sheet>
  );
}
