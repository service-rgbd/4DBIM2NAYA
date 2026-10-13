import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState, Loading, PageHeader } from "@/components/common";
import { errMsg, get } from "@/lib/api";
import { fmtDT } from "@/lib/format";

const ENTITIES = { "": "Toutes", project: "Projet", task: "Activités", dependency: "Dépendances", baseline: "Références", bim_version: "Maquettes", link_rule: "Règles de liaison" };

export default function AuditPage() {
  const { pid } = useParams();
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["audit", pid, page, entity], queryFn: () => get(`/projects/${pid}/audit`, { page, entity }) });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8 fade-up">
      <PageHeader title="Historique & audit" subtitle="Journal horodaté et non modifiable des actions importantes (auteur, ancienne et nouvelle valeur).">
        <select data-testid="audit-entity-select" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="h-9 rounded-md border border-slate-300 px-2 text-sm">
          {Object.entries(ENTITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </PageHeader>
      {isLoading && <Loading />}
      {error && <ErrorState message={errMsg(error)} onRetry={refetch} />}
      {data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-xs" data-testid="audit-table">
            <thead><tr className="border-b bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-3 py-2">Date</th><th>Auteur</th><th>Action</th><th>Détail</th><th>Changements</th></tr></thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono">{fmtDT(a.at)}</td>
                  <td className="py-2 pr-2">{a.user_email}</td>
                  <td className="py-2 pr-2 font-mono text-[10px] text-blue-700">{a.action}</td>
                  <td className="py-2 pr-2">{a.summary}</td>
                  <td className="max-w-[260px] py-2 pr-3 font-mono text-[10px] text-slate-500">{a.after && Object.keys(a.after).filter((k) => !["global_ids", "calendar", "filters"].includes(k)).map((k) => <div key={k}>{k} : {String(a.before?.[k] ?? "—")} → {String(a.after[k])}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
            <span data-testid="audit-total">{data.total} entrée(s)</span>
            <div className="flex items-center gap-2">
              <Button data-testid="audit-prev-btn" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
              <span>Page {page}/{pages}</span>
              <Button data-testid="audit-next-btn" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
