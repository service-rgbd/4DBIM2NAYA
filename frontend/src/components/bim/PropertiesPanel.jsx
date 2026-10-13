import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtShort } from "@/lib/format";
import { Loading } from "@/components/common";

export default function PropertiesPanel({ versionId, gid, onTaskClick }) {
  const { data: e, isLoading, error } = useQuery({ queryKey: ["element", versionId, gid], queryFn: () => get(`/model-versions/${versionId}/elements/${gid}`), enabled: !!gid && !!versionId });
  if (!gid) return <div className="p-4 text-xs text-slate-500">Sélectionnez un objet dans la maquette ou l'arborescence pour inspecter ses propriétés IFC.</div>;
  if (isLoading) return <Loading />;
  if (error || !e) return <div className="p-4 text-xs text-red-600">Objet introuvable dans la version courante.</div>;
  const groups = {};
  e.properties.forEach((p) => { (groups[p.pset] = groups[p.pset] || []).push(p); });
  const rows = [["GlobalId", e.global_id], ["Classe IFC", e.ifc_type], ["Nom", e.name], ["Type d'objet", e.object_type], ["Étage", e.storey], ["Discipline (déduite)", e.discipline], ["Tag", e.tag], ["ID STEP", `#${e.express_id}`]];
  return (
    <div className="space-y-3 p-3 text-xs" data-testid="properties-panel">
      <table className="w-full"><tbody>
        {rows.map(([k, v]) => <tr key={k} className="border-b border-slate-100"><td className="w-32 py-1 pr-2 text-slate-500">{k}</td><td className="break-all py-1 font-mono text-slate-800" data-testid={`prop-${k}`}>{v ?? "—"}</td></tr>)}
      </tbody></table>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Activités liées ({e.tasks.length})</div>
        {e.tasks.map((t) => <button key={t.id} data-testid={`prop-task-${t.code}`} onClick={() => onTaskClick?.(t.id)} className="block w-full truncate rounded border border-slate-200 px-2 py-1 text-left hover:bg-blue-50"><span className="font-mono">{t.code}</span> {t.name} <span className="text-slate-400">{fmtShort(t.early_start)}→{fmtShort(t.early_finish)}</span></button>)}
        {!e.tasks.length && <div className="text-slate-400">Aucune — objet non planifié.</div>}
      </div>
      {Object.entries(groups).map(([pset, props]) => (
        <details key={pset} className="rounded border border-slate-200">
          <summary className="cursor-pointer bg-slate-50 px-2 py-1 font-semibold text-slate-700">{pset} <span className="font-normal text-slate-400">({props.length})</span></summary>
          <table className="w-full"><tbody>{props.map((p, i) => <tr key={i} className="border-t border-slate-100"><td className="w-1/2 px-2 py-0.5 text-slate-500">{p.name}</td><td className="break-all px-2 py-0.5 font-mono">{String(p.value ?? "—")}</td></tr>)}</tbody></table>
        </details>
      ))}
    </div>
  );
}
