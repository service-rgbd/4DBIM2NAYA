import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { addDays, diffDays, fmtD } from "@/lib/format";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function evenDates(start, end, n) {
  const span = diffDays(start, end);
  return Array.from({ length: n }, (_, i) => addDays(start, Math.round((span * i) / (n - 1))));
}

/** Replays the simulation at evenly spaced dates, captures the viewer canvas and asks the server for a PDF. */
export default function ReportDialog({ pid, range, mode, modelName, setSimDate, countsAt, disabled }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(6);
  const [step, setStep] = useState(null);
  const run = async () => {
    const canvas = document.querySelector('[data-testid="ifc-viewer"] canvas');
    if (!canvas) return toast.error("Maquette non chargée : capture impossible");
    const captures = [];
    for (const [i, date] of evenDates(range.start, range.end, n).entries()) {
      setStep(`Capture ${i + 1}/${n} — ${fmtD(date)}`);
      setSimDate(date);
      await wait(700);
      captures.push({ date, image: canvas.toDataURL("image/jpeg", 0.72), counts: countsAt(date) });
    }
    setStep("Génération du PDF…");
    try {
      const r = await api.post(`/projects/${pid}/reports/4d`, { mode, model_name: modelName, captures }, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = Object.assign(document.createElement("a"), { href: url, download: `rapport-4d-${new Date().toISOString().slice(0, 10)}.pdf` });
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Rapport PDF généré");
      setOpen(false);
    } catch (e) {
      toast.error(e?.response?.data instanceof Blob ? JSON.parse(await e.response.data.text()).detail : errMsg(e));
    } finally { setStep(null); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !step && setOpen(o)}>
      <DialogTrigger asChild><Button data-testid="report-open-btn" size="sm" variant="outline" disabled={disabled}><FileDown className="mr-1.5 h-3.5 w-3.5" />Rapport PDF</Button></DialogTrigger>
      <DialogContent data-testid="report-dialog">
        <DialogHeader><DialogTitle className="font-heading">Rapport PDF de la simulation 4D</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">La simulation est rejouée en mode <b>{mode === "prevu" ? "Prévu" : mode === "reel" ? "Réel" : "Écart"}</b> à {n} dates réparties entre le {fmtD(range.start)} et le {fmtD(range.end)}. Chaque page contient la capture de la maquette, les comptages par phase et les activités en cours ; la couverture reprend les indicateurs enregistrés.</p>
        <Field label="Nombre de captures"><select data-testid="report-count-select" className="h-9 w-full rounded-md border px-2 text-sm" value={n} disabled={!!step} onChange={(e) => setN(Number(e.target.value))}>{[4, 6, 8, 12].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
        {step && <div className="flex items-center gap-2 text-sm text-blue-700" data-testid="report-progress"><Loader2 className="h-4 w-4 animate-spin" />{step}</div>}
        <Button data-testid="report-generate-btn" disabled={!!step} onClick={run} className="bg-blue-700 hover:bg-blue-800">Générer le rapport</Button>
      </DialogContent>
    </Dialog>
  );
}
