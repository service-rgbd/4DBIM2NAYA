import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Loading } from "@/components/common";
import { api, errMsg, get, patch, post } from "@/lib/api";
import { ISSUE_NEXT, ISSUE_STATUS, fmtD, fmtDT } from "@/lib/format";

function Photo({ issueId, photo }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    api.get(`/issues/${issueId}/photos/${photo.id}`, { responseType: "blob" }).then((r) => { u = URL.createObjectURL(r.data); setUrl(u); }).catch(() => setUrl(""));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [issueId, photo.id]);
  return (
    <a href={url || undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border" data-testid={`issue-photo-${photo.id}`}>
      {url ? <img src={url} alt={photo.filename} className="h-24 w-full object-cover" /> : <div className="grid h-24 place-items-center text-[10px] text-slate-400">{url === "" ? "Erreur" : "…"}</div>}
      <div className="px-1 py-0.5 text-[10px] text-slate-500">{photo.kind === "preuve" ? "Preuve" : "Constat"} · {fmtDT(photo.at)}</div>
    </a>
  );
}

function Workflow({ issue, refresh }) {
  const [note, setNote] = useState("");
  const go = async (status) => {
    try { await post(`/issues/${issue.id}/status`, { version: issue.version, status, note }); setNote(""); toast.success(`Statut : ${ISSUE_STATUS[status]}`); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="issue-workflow">
      <Field label="Note (preuve de résolution, motif…)"><Textarea data-testid="issue-status-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-1.5">
        {(ISSUE_NEXT[issue.status] || []).map((s) => <Button key={s} size="sm" variant={s === "cloture" ? "default" : "outline"} data-testid={`issue-status-${s}`} onClick={() => go(s)}>→ {ISSUE_STATUS[s]}</Button>)}
      </div>
    </div>
  );
}

function EditFields({ issue, refresh }) {
  const [f, setF] = useState({ responsible: issue.responsible, company: issue.company, due_date: issue.due_date || "", priority: issue.priority });
  const save = async () => {
    try { await patch(`/issues/${issue.id}`, { version: issue.version, ...f, due_date: f.due_date || null }); toast.success("Réserve mise à jour"); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Responsable"><Input data-testid="issue-edit-responsible" value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field>
      <Field label="Entreprise"><Input data-testid="issue-edit-company" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
      <Field label="Échéance"><Input data-testid="issue-edit-due" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      <Field label="Priorité"><select data-testid="issue-edit-priority" className="h-9 w-full rounded-md border px-2 text-sm" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{["basse", "normale", "haute", "critique"].map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Button data-testid="issue-edit-save" size="sm" variant="secondary" className="col-span-2" onClick={save}>Enregistrer</Button>
    </div>
  );
}

function Uploads({ issue, refresh }) {
  const [kind, setKind] = useState("constat");
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    try { await api.post(`/issues/${issue.id}/photos`, fd); toast.success("Photo ajoutée"); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">{issue.photos.map((p) => <Photo key={p.id} issueId={issue.id} photo={p} />)}</div>
      <div className="flex items-center gap-2">
        <select data-testid="issue-photo-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-md border px-2 text-xs"><option value="constat">Constat</option><option value="preuve">Preuve de résolution</option></select>
        <Input data-testid="issue-photo-input" type="file" accept="image/jpeg,image/png,image/webp" className="h-8 text-xs" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
}

function Comments({ issue, refresh }) {
  const [text, setText] = useState("");
  const send = async () => {
    try { await post(`/issues/${issue.id}/comments`, { text }); setText(""); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-2">
      {issue.comments.map((c) => <div key={c.id} className="rounded bg-slate-50 p-2 text-xs"><div className="text-slate-500">{c.by} · {fmtDT(c.at)}</div>{c.text}</div>)}
      <div className="flex gap-2"><Input data-testid="issue-comment-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ajouter un commentaire" /><Button data-testid="issue-comment-send" size="sm" disabled={!text.trim()} onClick={send}>Envoyer</Button></div>
    </div>
  );
}

const Section = ({ title, children }) => <div className="space-y-2"><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>{children}</div>;

export default function IssueSheet({ issueId, pid, onClose, canEdit }) {
  const qc = useQueryClient();
  const { data: issue, isLoading } = useQuery({ queryKey: ["issue", issueId], queryFn: () => get(`/issues/${issueId}`), enabled: !!issueId });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["issue", issueId] }); qc.invalidateQueries({ queryKey: ["issues", pid] }); };
  return (
    <Sheet open={!!issueId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="issue-sheet">
        {isLoading || !issue ? <Loading /> : (
          <div className="space-y-4">
            <SheetHeader><SheetTitle className="font-heading">{issue.reference} · {issue.title}</SheetTitle></SheetHeader>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-50 p-3 text-xs">
              <span>Statut : <b data-testid="issue-sheet-status">{ISSUE_STATUS[issue.status]}</b></span><span>Priorité : <b>{issue.priority}</b></span>
              <span>Étage / zone : {issue.storey || "—"} {issue.zone}</span><span>Échéance : <b className={issue.overdue ? "text-red-600" : ""}>{fmtD(issue.due_date)}</b></span>
              <span className="col-span-2 break-all">Objet BIM : {issue.global_id ? `${issue.ifc_type} · ${issue.element_name} (${issue.global_id})` : "aucun"}</span>
              {issue.resolution_note && <span className="col-span-2">Résolution : {issue.resolution_note}</span>}
            </div>
            {issue.description && <p className="text-sm text-slate-700">{issue.description}</p>}
            <Workflow issue={issue} refresh={refresh} />
            {canEdit && <Section title="Affectation"><EditFields key={issue.version} issue={issue} refresh={refresh} /></Section>}
            <Section title={`Photos (${issue.photos.length})`}><Uploads issue={issue} refresh={refresh} /></Section>
            <Section title="Commentaires"><Comments issue={issue} refresh={refresh} /></Section>
            <Section title="Historique">{issue.history.map((h) => <div key={h.id} className="border-b py-1 text-[11px]"><span className="font-mono text-slate-500">{fmtDT(h.at)}</span> {h.user_email} — {h.summary}</div>)}</Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
