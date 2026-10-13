import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Box, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DemoBadge, EmptyState, ErrorState, Field, Loading, PageHeader } from "@/components/common";
import { useProjects } from "@/hooks/useProjectData";
import { errMsg, post } from "@/lib/api";
import { PROJECT_STATUS, fmtD } from "@/lib/format";

const schema = z.object({
  name: z.string().min(2, "2 caractères minimum").max(160),
  reference: z.string().regex(/^[A-Za-z0-9_\-.]{2,40}$/, "Lettres, chiffres, - _ . (2 à 40)"),
  operation_type: z.string().max(80), address: z.string().max(300), client: z.string().max(160), architect: z.string().max(160),
  start_planned: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date requise"), end_planned: z.string().optional(), description: z.string().max(4000),
});

function CreateProject() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { operation_type: "Construction neuve", description: "", address: "", client: "", architect: "" } });
  const submit = async (v) => {
    try {
      await post("/projects", { ...v, end_planned: v.end_planned || null });
      toast.success("Projet créé");
      qc.invalidateQueries({ queryKey: ["projects"] });
      reset(); setOpen(false);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="create-project-open-btn" className="bg-blue-700 hover:bg-blue-800"><Plus className="mr-2 h-4 w-4" />Nouveau projet</Button></DialogTrigger>
      <DialogContent className="max-w-xl" data-testid="create-project-dialog">
        <DialogHeader><DialogTitle className="font-heading">Créer un projet de construction</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Nom *" error={errors.name?.message}><Input data-testid="project-name-input" {...register("name")} /></Field></div>
          <Field label="Référence unique *" error={errors.reference?.message}><Input data-testid="project-reference-input" {...register("reference")} placeholder="OP-2026-001" /></Field>
          <Field label="Type d'opération"><Input data-testid="project-type-input" {...register("operation_type")} /></Field>
          <div className="col-span-2"><Field label="Adresse"><Input data-testid="project-address-input" {...register("address")} /></Field></div>
          <Field label="Maître d'ouvrage"><Input data-testid="project-client-input" {...register("client")} /></Field>
          <Field label="Maître d'œuvre"><Input data-testid="project-architect-input" {...register("architect")} /></Field>
          <Field label="Début prévu *" error={errors.start_planned?.message}><Input data-testid="project-start-input" type="date" {...register("start_planned")} /></Field>
          <Field label="Fin prévue"><Input data-testid="project-end-input" type="date" {...register("end_planned")} /></Field>
          <div className="col-span-2"><Field label="Description"><Textarea data-testid="project-description-input" rows={2} {...register("description")} /></Field></div>
          <Button data-testid="create-project-submit-btn" disabled={isSubmitting} type="submit" className="col-span-2 bg-blue-700 hover:bg-blue-800">Créer le projet</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const Bar = ({ planned, actual }) => (
  <div className="space-y-1">
    <div className="h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-slate-400" style={{ width: `${planned}%` }} /></div>
    <div className="h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${actual < planned ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${actual}%` }} /></div>
  </div>
);

export default function ProjectsPage() {
  const { data, isLoading, error, refetch } = useProjects();
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8 fade-up">
      <PageHeader title="Projets" subtitle="Chantiers accessibles selon vos droits. Indicateurs calculés depuis le planning enregistré."><CreateProject /></PageHeader>
      {isLoading && <Loading />}
      {error && <ErrorState message={errMsg(error)} onRetry={refetch} />}
      {data && !data.length && <EmptyState title="Aucun projet">Créez votre premier projet pour commencer le planning et l'import IFC.</EmptyState>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {data?.length > 0 && (
          <table className="w-full min-w-[860px] text-sm" data-testid="projects-table">
            <thead><tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Projet</th><th>Statut</th><th>Dates prévues</th><th className="w-44">Avancement prévu / réel</th><th>Activités</th><th>BIM</th>
            </tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50" data-testid={`project-row-${p.reference}`}>
                  <td className="px-4 py-3">
                    <Link to={`/projects/${p.id}`} className="font-semibold text-slate-900 hover:text-blue-700" data-testid={`project-link-${p.reference}`}>{p.name}</Link>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-slate-500">{p.reference} {p.is_demo && <DemoBadge />}</div>
                  </td>
                  <td><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{PROJECT_STATUS[p.status]}</span></td>
                  <td className="font-mono text-xs text-slate-600">{fmtD(p.start_planned)}<br />{fmtD(p.computed_finish || p.end_planned)}</td>
                  <td className="pr-4"><Bar planned={p.kpis.planned_progress} actual={p.kpis.actual_progress} /><div className="mt-1 font-mono text-[11px] text-slate-500">{p.kpis.planned_progress} % / {p.kpis.actual_progress} %</div></td>
                  <td className="text-xs">{p.kpis.tasks_total} <span className="text-red-600">{p.kpis.tasks_delayed ? `· ${p.kpis.tasks_delayed} en retard` : ""}</span></td>
                  <td className="text-xs"><span className="flex items-center gap-1"><Box className="h-3.5 w-3.5 text-slate-400" />{p.model_count} maquette(s) · {p.link_count} liaisons</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
