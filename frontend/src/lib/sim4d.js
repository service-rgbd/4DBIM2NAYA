/*
 Logique temporelle 4D (documentée, déterministe, recalculable depuis les données stockées).
 Entrées : activités (dates CPM calculées par le serveur, dates réelles, statut), liaisons objet-activité, date D.
 - Mode « prévu » : D < début → à réaliser ; début ≤ D ≤ fin → en cours ; D > fin → terminé.
 - Mode « réel » : D est borné à aujourd'hui (aucune extrapolation). Terminé si fin réelle ≤ D ;
   démarré et non terminé → en cours (bloqué si statut bloqué, en retard si D > fin prévue) ;
   non démarré → bloqué si statut bloqué, en retard si D > début prévu, sinon à réaliser.
 - Mode « écart » : compare les rangs prévu/réel (à réaliser < en cours < terminé).
 Objet lié à plusieurs activités : retard > bloqué > en cours > (terminé si toutes terminées) ;
 un mélange terminé / à réaliser est rendu « en cours » (entre deux phases successives).
 Objet sans liaison : non planifié.
*/
export const PHASE_COLORS = {
  a_realiser: "#94A3B8", en_cours: "#3B82F6", termine: "#10B981", en_retard: "#EF4444", bloque: "#F97316",
  non_planifie: "#E2E8F0", en_avance: "#8B5CF6", conforme: "#10B981", hors_filtre: "#E2E8F0",
};
export const LEGENDS = {
  prevu: ["a_realiser", "en_cours", "termine", "non_planifie"],
  reel: ["a_realiser", "en_cours", "termine", "en_retard", "bloque", "non_planifie"],
  ecart: ["conforme", "en_retard", "en_avance", "bloque", "non_planifie"],
};
export const PHASE_LABELS = {
  a_realiser: "À réaliser", en_cours: "En cours", termine: "Terminé", en_retard: "En retard", bloque: "Bloqué",
  non_planifie: "Non planifié", en_avance: "En avance", conforme: "Conforme au prévu", hors_filtre: "Hors filtre",
};

export function plannedPhase(t, d) {
  if (d < t.early_start) return "a_realiser";
  if (d > t.early_finish) return "termine";
  return t.is_milestone ? "termine" : "en_cours";
}

export function actualPhase(t, d, today) {
  const D = d > today ? today : d;
  if (t.actual_end && t.actual_end <= D) return "termine";
  if (t.actual_start && t.actual_start <= D) {
    if (t.status === "bloque") return "bloque";
    return D > t.early_finish ? "en_retard" : "en_cours";
  }
  if (t.status === "bloque" && D >= t.early_start) return "bloque";
  return D > t.early_start ? "en_retard" : "a_realiser";
}

const RANK = { a_realiser: 0, en_cours: 1, en_retard: 1, bloque: 1, termine: 2 };

function combine(phases) {
  if (!phases.length) return "non_planifie";
  if (phases.includes("en_retard")) return "en_retard";
  if (phases.includes("bloque")) return "bloque";
  if (phases.includes("en_cours")) return "en_cours";
  if (phases.every((p) => p === "termine")) return "termine";
  if (phases.every((p) => p === "a_realiser")) return "a_realiser";
  return "en_cours";
}

export function taskPhase(t, d, mode, today) {
  if (mode === "prevu") return plannedPhase(t, d);
  if (mode === "reel") return actualPhase(t, d, today);
  const a = actualPhase(t, d, today);
  if (a === "bloque") return "bloque";
  const p = plannedPhase(t, d);
  const ra = a === "en_retard" ? 0.5 : RANK[a];
  if (ra < RANK[p]) return "en_retard";
  if (ra > RANK[p]) return "en_avance";
  return "conforme";
}

/** Returns Map(global_id -> phase) for all linked objects. */
export function computeElementPhases(tasks, linksByGid, d, mode, today, visibleTaskIds) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map();
  for (const [gid, taskIds] of linksByGid) {
    const active = taskIds.map((id) => byId.get(id)).filter((t) => t && t.status !== "annule");
    const shown = visibleTaskIds ? active.filter((t) => visibleTaskIds.has(t.id)) : active;
    if (!active.length) continue;
    if (!shown.length) { out.set(gid, "hors_filtre"); continue; }
    const phases = shown.map((t) => taskPhase(t, d, mode, today));
    if (mode === "ecart") {
      out.set(gid, phases.includes("en_retard") ? "en_retard" : phases.includes("bloque") ? "bloque" : phases.includes("en_avance") ? "en_avance" : "conforme");
    } else out.set(gid, combine(phases));
  }
  return out;
}
