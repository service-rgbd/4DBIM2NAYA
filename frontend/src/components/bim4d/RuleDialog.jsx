import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Filter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common";
import { errMsg, get, post } from "@/lib/api";
import { invalidatePlanning } from "@/hooks/useProjectData";

const EMPTY = { ifc_types: [], storeys: [], disciplines: [], name_contains: "", property_name: "", property_value: "" };

const Chips = ({ items, value, onChange, testid }) => (
  <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto" data-testid={testid}>
    {items.map((i) => {
      const on = value.includes(i.value);
      return <button type="button" key={i.value} data-testid={`${testid}-${i.value}`} onClick={() => onChange(on ? value.filter((v) => v !== i.value) : [...value, i.value])}
        className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{i.value} <span className="opacity-60">{i.count}</span></button>;
    })}
  </div>
);

/** Rule-based batch linking: filter IFC objects by properties, preview, then persist the rule and its links. */
export default function RuleDialog({ pid, modelId, versionId, tasks, defaultTaskId, onPreviewSelect }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [taskId, setTaskId] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: facets } = useQuery({ queryKey: ["facets", versionId], queryFn: () => get(`/model-versions/${versionId}/facets`), enabled: open && !!versionId });
  const set = (k, v) => { setF({ ...f, [k]: v }); setPreview(null); };
  const run = async () => {
    try { setPreview(await post(`/projects/${pid}/link-rules/preview`, { model_id: modelId, filters: f })); } catch (e) { toast.error(errMsg(e)); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await post(`/projects/${pid}/link-rules`, { model_id: modelId, task_id: taskId || defaultTaskId, name, filters: f });
      toast.success(`${r.created} objet(s) IFC lié(s) — règle « ${name} » enregistrée`);
      qc.invalidateQueries({ queryKey: ["links", pid] });
      qc.invalidateQueries({ queryKey: ["rules", pid] });
      invalidatePlanning(qc, pid);
      setOpen(false);
      setF(EMPTY); setPreview(null); setName("");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setTaskId(defaultTaskId || ""); }}>
      <DialogTrigger asChild><Button data-testid="rule-open-btn" size="sm" variant="outline" disabled={!versionId}><Filter className="mr-1.5 h-3.5 w-3.5" />Liaison par règle</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="rule-dialog">
        <DialogHeader><DialogTitle className="font-heading">Liaison par lots selon les propriétés IFC</DialogTitle></DialogHeader>
        {!facets ? <div className="text-sm text-slate-500">Chargement des propriétés de la maquette…</div> : (
          <div className="space-y-3">
            <Field label="Classes IFC"><Chips testid="rule-types" items={facets.ifc_types} value={f.ifc_types} onChange={(v) => set("ifc_types", v)} /></Field>
            <Field label="Étages"><Chips testid="rule-storeys" items={facets.storeys} value={f.storeys} onChange={(v) => set("storeys", v)} /></Field>
            <Field label="Disciplines (déduites)"><Chips testid="rule-disciplines" items={facets.disciplines} value={f.disciplines} onChange={(v) => set("disciplines", v)} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Nom contient"><Input data-testid="rule-name-contains" value={f.name_contains} onChange={(e) => set("name_contains", e.target.value)} /></Field>
              <Field label="Propriété"><select data-testid="rule-property-select" className="h-9 w-full rounded-md border px-2 text-sm" value={f.property_name} onChange={(e) => set("property_name", e.target.value)}><option value="">—</option>{facets.properties.map((p) => <option key={p.value} value={p.value}>{p.value} ({p.count})</option>)}</select></Field>
              <Field label="Valeur"><Input data-testid="rule-property-value" value={f.property_value} onChange={(e) => set("property_value", e.target.value)} placeholder="ex. true" /></Field>
            </div>
            <Button data-testid="rule-preview-btn" type="button" variant="secondary" size="sm" onClick={run}>Prévisualiser</Button>
            {preview && (
              <div className="rounded-md border bg-slate-50 p-3 text-xs" data-testid="rule-preview-result">
                <div className="mb-1 flex items-center justify-between"><b data-testid="rule-preview-count">{preview.count} objet(s) correspondant(s)</b><span>{preview.already_linked} déjà lié(s) à une activité</span></div>
                <div className="max-h-28 overflow-y-auto">{preview.sample.map((s) => <div key={s.global_id} className="truncate font-mono text-[10px] text-slate-600">{s.ifc_type} · {s.storey} · {s.name}</div>)}</div>
                <Button data-testid="rule-show-in-model-btn" size="sm" variant="outline" className="mt-2" onClick={() => onPreviewSelect(preview.global_ids)}>Surligner dans la maquette</Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 border-t pt-3">
              <Field label="Activité cible"><select data-testid="rule-task-select" className="h-9 w-full rounded-md border px-2 text-sm" value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">— choisir —</option>{tasks.filter((t) => !t.is_milestone).map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}</option>)}</select></Field>
              <Field label="Nom de la règle"><Input data-testid="rule-name-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            </div>
            <Button data-testid="rule-save-btn" disabled={!preview?.count || !taskId || name.length < 2 || busy} onClick={save} className="w-full bg-blue-700 hover:bg-blue-800">Enregistrer la règle et créer les liaisons</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
