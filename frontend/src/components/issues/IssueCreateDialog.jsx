import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common";
import { errMsg, post } from "@/lib/api";
import { ISSUE_CATEGORY } from "@/lib/format";

const EMPTY = { title: "", description: "", category: "reserve", priority: "normale", zone: "", responsible: "", company: "", due_date: "" };
const sel = "h-9 w-full rounded-md border px-2 text-sm";

/** Creates a field issue, optionally anchored to an IFC object (GlobalId) of the current model. */
export default function IssueCreateDialog({ pid, open, onClose, element, modelId, onCreated }) {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, due_date: f.due_date || null, storey: element?.storey || "", ...(element ? { model_id: modelId, global_id: element.global_id } : {}) };
      const i = await post(`/projects/${pid}/issues`, body);
      toast.success(`Réserve ${i.reference} créée`);
      qc.invalidateQueries({ queryKey: ["issues", pid] });
      if (element) qc.invalidateQueries({ queryKey: ["element"] });
      setF(EMPTY);
      onCreated?.(i);
      onClose();
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="issue-create-dialog">
        <DialogHeader><DialogTitle className="font-heading">Nouvelle réserve</DialogTitle><DialogDescription>Fiche de terrain suivie jusqu'à la clôture avec preuve.</DialogDescription></DialogHeader>
        {element && <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" data-testid="issue-create-element">Objet BIM : {element.ifc_type} · {element.name} · {element.storey}</div>}
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Titre *"><Input data-testid="issue-title-input" required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
          <Field label="Catégorie"><select data-testid="issue-category-select" className={sel} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(ISSUE_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Priorité"><select data-testid="issue-priority-select" className={sel} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{["basse", "normale", "haute", "critique"].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Responsable"><Input data-testid="issue-responsible-input" value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field>
          <Field label="Entreprise concernée"><Input data-testid="issue-company-input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
          <Field label="Zone"><Input data-testid="issue-zone-input" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} /></Field>
          <Field label="Échéance"><Input data-testid="issue-due-input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <div className="col-span-2"><Field label="Description"><Textarea data-testid="issue-description-input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
          <Button data-testid="issue-create-submit" type="submit" disabled={busy} className="col-span-2 bg-blue-700 hover:bg-blue-800">Créer la réserve</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
