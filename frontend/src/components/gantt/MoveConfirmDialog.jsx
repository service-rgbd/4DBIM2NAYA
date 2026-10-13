import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/common";
import { errMsg, patch, post } from "@/lib/api";
import { fmtD } from "@/lib/format";
import { invalidatePlanning } from "@/hooks/useProjectData";

/** Verifies a drag (dependencies, impacts) on the server before the change is persisted. */
export default function MoveConfirmDialog({ move, pid, onClose }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!move) { setPreview(null); return; }
    post(`/tasks/${move.task.id}/preview-move`, move.change).then(setPreview).catch((e) => { toast.error(errMsg(e)); closeRef.current(); });
  }, [move]);

  const confirm = async () => {
    setBusy(true);
    try {
      await patch(`/tasks/${move.task.id}`, { version: move.task.version, ...move.change });
      toast.success("Planning mis à jour et recalculé");
      invalidatePlanning(qc, pid);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
      invalidatePlanning(qc, pid);
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!move} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="move-confirm-dialog">
        <DialogHeader><DialogTitle className="font-heading">Confirmer la modification de {move?.task.code}</DialogTitle></DialogHeader>
        {!preview ? <Loading label="Vérification des dépendances…" /> : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 text-xs">
              <div><div className="text-slate-500">Début demandé</div><div className="font-mono font-semibold">{fmtD(preview.requested_start)}</div></div>
              <div><div className="text-slate-500">Début effectif</div><div className="font-mono font-semibold" data-testid="move-effective-start">{fmtD(preview.effective_start)} → {fmtD(preview.effective_finish)}</div></div>
              <div><div className="text-slate-500">Fin de projet actuelle</div><div className="font-mono">{fmtD(preview.project_finish_before)}</div></div>
              <div><div className="text-slate-500">Fin de projet après</div><div className={`font-mono font-semibold ${preview.project_finish_after > preview.project_finish_before ? "text-red-600" : ""}`}>{fmtD(preview.project_finish_after)}</div></div>
            </div>
            {preview.blocked_by.length > 0 && (
              <div className="flex gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800" data-testid="move-blocked-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div>Le début demandé est contraint par : <b>{preview.blocked_by.join(", ")}</b>. L'activité démarrera au plus tôt le {fmtD(preview.effective_start)}.</div>
              </div>
            )}
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{preview.impacted.length} activité(s) impactée(s)</div>
              <div className="max-h-48 space-y-1 overflow-y-auto" data-testid="move-impacted-list">
                {preview.impacted.map((i) => <div key={i.id} className="flex justify-between border-b py-1 text-xs"><span className="truncate">{i.label}</span><span className="font-mono text-slate-600">{fmtD(i.old_start)} → {fmtD(i.new_start)}</span></div>)}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button data-testid="move-cancel-btn" variant="outline" onClick={onClose}>Annuler</Button>
          <Button data-testid="move-confirm-btn" disabled={!preview || busy} onClick={confirm} className="bg-blue-700 hover:bg-blue-800">Appliquer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
