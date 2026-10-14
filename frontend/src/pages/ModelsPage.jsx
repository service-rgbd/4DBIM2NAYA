import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import IfcViewer from "@/components/bim/IfcViewer";
import ModelTree from "@/components/bim/ModelTree";
import PropertiesPanel from "@/components/bim/PropertiesPanel";
import UploadModelDialog from "@/components/bim/UploadModelDialog";
import IssueCreateDialog from "@/components/issues/IssueCreateDialog";
import { useElements, useModels, useProject } from "@/hooks/useProjectData";
import { errMsg, post } from "@/lib/api";
import { MODEL_STATUS, canWrite, fmtDT } from "@/lib/format";

function VersionRow({ v, current, canRetry, onRetry }) {
  const s = MODEL_STATUS[v.status];
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs" data-testid={`model-version-${v.version_no}`}>
      <span className="font-mono font-semibold">v{v.version_no}</span>
      <span className={`rounded px-1.5 py-0.5 font-semibold ${s.cls}`} data-testid={`model-version-status-${v.version_no}`}>{s.label}{v.status === "traitement" ? ` ${v.progress} %` : ""}</span>
      {current && <span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">courante</span>}
      <span className="truncate text-slate-500">{v.filename} · {Math.round(v.size / 1024)} Ko · {v.element_count ?? "?"} objets · {v.schema || ""} · unité {v.length_unit || "?"}</span>
      <span className="font-mono text-[10px] text-slate-400" title={v.sha256}>sha256 {v.sha256.slice(0, 10)}…</span>
      <span className="ml-auto text-slate-400">{fmtDT(v.created_at)}</span>
      {v.error && <div className="w-full text-red-600" data-testid="model-version-error">{v.stage} — {v.error}</div>}
      {v.status === "echec" && canRetry && <button data-testid="model-retry-btn" onClick={() => onRetry(v.id)} className="flex items-center gap-1 font-semibold text-blue-700"><RotateCcw className="h-3 w-3" />Relancer</button>}
    </div>
  );
}

export default function ModelsPage() {
  const { pid } = useParams();
  const qc = useQueryClient();
  const { data: project } = useProject(pid);
  const { data: models, isLoading, error, refetch } = useModels(pid);
  const [modelId, setModelId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [hidden, setHidden] = useState({ storeys: new Set(), types: new Set() });
  const [focus, setFocus] = useState(null);
  const [issueElement, setIssueElement] = useState(null);
  const model = models?.find((m) => m.id === modelId) || models?.find((m) => m.current_version_id);
  const vid = model?.current_version_id;
  const { data: elements } = useElements(vid);
  const isVisible = useCallback((e) => !hidden.storeys.has(e.storey) && !hidden.types.has(e.ifc_type), [hidden]);
  const pick = (gid, add) => {
    setSelected((s) => { if (!gid) return new Set(); const n = new Set(add ? s : []); n.has(gid) && add ? n.delete(gid) : n.add(gid); return n; });
  };
  const retry = async (id) => {
    try { await post(`/model-versions/${id}/retry`); qc.invalidateQueries({ queryKey: ["models", pid] }); toast.success("Traitement relancé"); } catch (e) { toast.error(errMsg(e)); }
  };
  const one = selected.size === 1 ? [...selected][0] : null;
  const colorMap = useMemo(() => null, []);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={errMsg(error)} onRetry={refetch} />;
  return (
    <div className="flex h-full flex-col p-4 md:p-6">
      <PageHeader title="Maquettes BIM" subtitle="Import IFC asynchrone (extraction serveur des entités, étages, propriétés), visualisation 3D web-ifc.">
        {canWrite(project?.my_role) && <UploadModelDialog pid={pid} models={models} />}
      </PageHeader>
      {!models.length && <EmptyState title="Aucune maquette" testid="models-empty">Importez un fichier IFC. Le planning et les activités restent utilisables sans maquette.</EmptyState>}
      <div className="space-y-2">
        {models.map((m) => (
          <div key={m.id} className={`rounded-lg border bg-white shadow-sm ${model?.id === m.id ? "border-blue-400" : "border-slate-200"}`} data-testid={`model-card-${m.id}`}>
            <button onClick={() => { setModelId(m.id); setSelected(new Set()); }} className="flex w-full items-center gap-3 px-3 py-2 text-left" data-testid="model-select-btn">
              <span className="font-heading font-semibold text-slate-900">{m.name}</span><span className="text-xs text-slate-500">{m.discipline} · {m.link_count} liaisons</span>
            </button>
            {m.versions.map((v) => <VersionRow key={v.id} v={v} current={v.id === m.current_version_id} canRetry={canWrite(project?.my_role)} onRetry={retry} />)}
          </div>
        ))}
      </div>
      {vid && (
        <div className="mt-4 grid min-h-[520px] flex-1 grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-[260px_1fr_300px]">
          <div className="h-64 border-b lg:h-auto lg:border-b-0 lg:border-r"><ModelTree elements={elements} selectedGids={selected} onSelect={(g, add) => { pick(g, add); setFocus({ gids: [g] }); }} hidden={hidden} setHidden={setHidden} /></div>
          <IfcViewer className="h-[420px] lg:h-auto" versionId={vid} elements={elements} colorMap={colorMap} selectedGids={selected} onPick={pick} isVisible={isVisible} focusRequest={focus} />
          <div className="overflow-y-auto border-t scroll-thin lg:border-l lg:border-t-0">
            <div className="border-b px-3 py-2 font-heading text-sm font-semibold">Propriétés {selected.size > 1 && <span className="text-xs font-normal text-slate-500">({selected.size} objets sélectionnés)</span>}</div>
            <PropertiesPanel versionId={vid} gid={one} onCreateIssue={canWrite(project?.my_role) ? setIssueElement : undefined} />
          </div>
        </div>
      )}
      <IssueCreateDialog pid={pid} open={!!issueElement} onClose={() => setIssueElement(null)} element={issueElement} modelId={model?.id} />
    </div>
  );
}
