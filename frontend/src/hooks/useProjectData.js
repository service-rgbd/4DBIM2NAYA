import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { buildIssuePins } from "@/components/bim/IssuePins";

export function useIssuePins(pid, modelId) {
  const { data } = useQuery({ queryKey: ["issues", pid, "pins"], queryFn: () => get(`/projects/${pid}/issues`), enabled: !!pid });
  return useMemo(() => buildIssuePins(data?.items, modelId), [data, modelId]);
}

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => get("/projects") });
export const useProject = (pid) => useQuery({ queryKey: ["project", pid], queryFn: () => get(`/projects/${pid}`), enabled: !!pid });
export const usePlanning = (pid) => useQuery({ queryKey: ["tasks", pid], queryFn: () => get(`/projects/${pid}/tasks`), enabled: !!pid, staleTime: 5000 });
export const useDashboard = (pid) => useQuery({ queryKey: ["dashboard", pid], queryFn: () => get(`/projects/${pid}/dashboard`), enabled: !!pid, staleTime: 5000 });
export const useModels = (pid) => useQuery({
  queryKey: ["models", pid], queryFn: () => get(`/projects/${pid}/models`), enabled: !!pid,
  refetchInterval: (q) => ((q.state.data || []).some((m) => m.versions.some((v) => ["en_attente", "traitement"].includes(v.status))) ? 2000 : false),
});
export const useElements = (vid) => useQuery({ queryKey: ["elements", vid], queryFn: () => get(`/model-versions/${vid}/elements`), enabled: !!vid, staleTime: Infinity });
export const useLinks = (pid, mid) => useQuery({ queryKey: ["links", pid, mid], queryFn: () => get(`/projects/${pid}/links`, { model_id: mid }), enabled: !!pid && !!mid, staleTime: 5000 });
export const useBaselines = (pid) => useQuery({ queryKey: ["baselines", pid], queryFn: () => get(`/projects/${pid}/baselines`), enabled: !!pid });

export const invalidatePlanning = (qc, pid) => {
  qc.invalidateQueries({ queryKey: ["tasks", pid] });
  qc.invalidateQueries({ queryKey: ["dashboard", pid] });
  qc.invalidateQueries({ queryKey: ["projects"] });
};
