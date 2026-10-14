import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Kpi, Loading, PageHeader } from "@/components/common";
import IssueCreateDialog from "@/components/issues/IssueCreateDialog";
import IssueSheet from "@/components/issues/IssueSheet";
import { useProject } from "@/hooks/useProjectData";
import { errMsg, get } from "@/lib/api";
import { ISSUE_CATEGORY, ISSUE_STATUS, canWrite, fmtD } from "@/lib/format";

const PRIO = { critique: "bg-red-50 text-red-700", haute: "bg-orange-50 text-orange-700", normale: "bg-slate-100 text-slate-700", basse: "bg-slate-50 text-slate-500" };
const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";

export default function IssuesPage() {
  const { pid } = useParams();
  const { data: project } = useProject(pid);
  const [filters, setFilters] = useState({ status: "", priority: "" });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["issues", pid, filters], queryFn: () => get(`/projects/${pid}/issues`, filters) });
  const editable = canWrite(project?.my_role);
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8 fade-up">
      <PageHeader title="Réserves & incidents" subtitle="Fiches de terrain, liées ou non à un objet de la maquette, suivies jusqu'à la clôture avec preuve.">
        <select data-testid="issues-filter-status" className={sel} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Tous statuts</option>{Object.entries(ISSUE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select data-testid="issues-filter-priority" className={sel} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option value="">Toutes priorités</option>{Object.keys(PRIO).map((p) => <option key={p}>{p}</option>)}</select>
        {editable && <Button data-testid="issue-new-btn" className="bg-blue-700 hover:bg-blue-800" onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Nouvelle réserve</Button>}
      </PageHeader>
      {isLoading && <Loading />}
      {error && <ErrorState message={errMsg(error)} onRetry={refetch} />}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi testid="issues-kpi-open" label="Ouvertes" value={data.stats.open} />
            <Kpi testid="issues-kpi-critical" label="Critiques ouvertes" value={data.stats.critical_open} tone={data.stats.critical_open ? "text-red-600" : ""} />
            <Kpi testid="issues-kpi-overdue" label="Échéance dépassée" value={data.stats.overdue} tone={data.stats.overdue ? "text-red-600" : ""} />
            <Kpi testid="issues-kpi-closed" label="Clôturées" value={data.stats.closed} />
          </div>
          {!data.items.length ? <EmptyState title="Aucune réserve" testid="issues-empty">Créez une réserve ici ou depuis un objet sélectionné dans la maquette (Espace 4D, onglet Objet).</EmptyState> : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[820px] text-sm" data-testid="issues-table">
                <thead><tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-3 py-2">Réf.</th><th>Titre</th><th>Catégorie</th><th>Priorité</th><th>Objet BIM / étage</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr></thead>
                <tbody>{data.items.map((i) => (
                  <tr key={i.id} onClick={() => setOpenId(i.id)} className="cursor-pointer border-b last:border-0 hover:bg-slate-50" data-testid={`issue-row-${i.reference}`}>
                    <td className="px-3 py-2 font-mono text-xs">{i.reference}</td><td className="font-medium">{i.title}</td><td className="text-xs">{ISSUE_CATEGORY[i.category]}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PRIO[i.priority]}`}>{i.priority}</span></td>
                    <td className="text-xs text-slate-600">{i.global_id ? `${i.ifc_type} · ${i.element_name}` : "—"}<br />{i.storey}</td>
                    <td className="text-xs">{i.responsible || "—"}<br /><span className="text-slate-500">{i.company}</span></td>
                    <td className={`font-mono text-xs ${i.overdue ? "font-bold text-red-600" : ""}`}>{fmtD(i.due_date)}</td>
                    <td className="text-xs font-semibold">{ISSUE_STATUS[i.status]}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      <IssueCreateDialog pid={pid} open={creating} onClose={() => setCreating(false)} onCreated={(i) => setOpenId(i.id)} />
      <IssueSheet issueId={openId} pid={pid} onClose={() => setOpenId(null)} canEdit={editable} />
    </div>
  );
}
