import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common";
import { api, errMsg } from "@/lib/api";

const sel = "h-9 w-full rounded-md border border-input bg-white px-2 text-sm";

export default function UploadModelDialog({ pid, models }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ file: null, name: "", discipline: "Architecture", model_id: "" });
  const [pct, setPct] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.file) return toast.error("Choisissez un fichier .ifc");
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
    setPct(0);
    try {
      await api.post(`/projects/${pid}/models`, fd, { onUploadProgress: (p) => p.total && setPct(Math.round((p.loaded / p.total) * 100)) });
      toast.success("Fichier déposé — traitement IFC en arrière-plan");
      qc.invalidateQueries({ queryKey: ["models", pid] });
      setOpen(false);
      setF({ file: null, name: "", discipline: "Architecture", model_id: "" });
    } catch (err) { toast.error(errMsg(err)); } finally { setPct(null); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="upload-model-open-btn" className="bg-blue-700 hover:bg-blue-800"><Upload className="mr-2 h-4 w-4" />Importer un IFC</Button></DialogTrigger>
      <DialogContent data-testid="upload-model-dialog">
        <DialogHeader><DialogTitle className="font-heading">Importer une maquette IFC</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Fichier IFC (STEP .ifc, 200 Mo max.)"><Input data-testid="upload-file-input" type="file" accept=".ifc" onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null })} /></Field>
          <Field label="Nouvelle version d'une maquette existante ?">
            <select data-testid="upload-model-select" className={sel} value={f.model_id} onChange={(e) => setF({ ...f, model_id: e.target.value })}>
              <option value="">Non — nouvelle maquette</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          {!f.model_id && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nom"><Input data-testid="upload-name-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nom du fichier" /></Field>
              <Field label="Discipline"><select data-testid="upload-discipline-select" className={sel} value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>{["Architecture", "Structure", "CVC / Fluides", "Électricité", "VRD", "Synthèse"].map((d) => <option key={d}>{d}</option>)}</select></Field>
            </div>
          )}
          <p className="text-xs text-slate-500">Le fichier est stocké avec son empreinte SHA-256 ; les liaisons existantes sont conservées par GlobalId lors d'une nouvelle version.</p>
          <Button data-testid="upload-submit-btn" type="submit" disabled={pct !== null} className="w-full bg-blue-700 hover:bg-blue-800">{pct !== null && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pct !== null ? `Envoi… ${pct} %` : "Déposer et traiter"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
