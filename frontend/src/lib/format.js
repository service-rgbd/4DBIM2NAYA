export const HEALTH = {
  a_realiser: { label: "À réaliser", cls: "bg-slate-50 text-slate-600 border-slate-200", hex: "#94A3B8" },
  en_cours: { label: "En cours", cls: "bg-blue-50 text-blue-700 border-blue-200", hex: "#3B82F6" },
  termine: { label: "Terminé", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", hex: "#10B981" },
  en_retard: { label: "En retard", cls: "bg-red-50 text-red-700 border-red-200", hex: "#EF4444" },
  bloque: { label: "Bloqué", cls: "bg-orange-50 text-orange-700 border-orange-200", hex: "#F97316" },
  annule: { label: "Annulé", cls: "bg-slate-100 text-slate-400 border-slate-200 line-through", hex: "#CBD5E1" },
  non_planifie: { label: "Non planifié", cls: "bg-white text-slate-500 border-dashed border-slate-300", hex: "#E2E8F0" },
};

export const TASK_STATUS = {
  a_planifier: "À planifier", a_faire: "À faire", en_cours: "En cours", bloque: "Bloqué", termine: "Terminé", annule: "Annulé",
};

export const PROJECT_STATUS = {
  preparation: "Préparation", actif: "Actif", suspendu: "Suspendu", en_retard: "En retard",
  en_reception: "En réception", livre: "Livré", archive: "Archivé",
};

export const MODEL_STATUS = {
  en_attente: { label: "En file d'attente", cls: "bg-slate-100 text-slate-700" },
  traitement: { label: "Traitement en cours", cls: "bg-blue-50 text-blue-700" },
  pret: { label: "Prêt", cls: "bg-emerald-50 text-emerald-700" },
  echec: { label: "Échec", cls: "bg-red-50 text-red-700" },
};

export const DEP_TYPES = { FS: "Fin → Début", SS: "Début → Début", FF: "Fin → Fin", SF: "Début → Fin" };
export const ISSUE_STATUS = { ouvert: "Ouvert", affecte: "Affecté", en_cours: "En cours", a_verifier: "À vérifier", resolu: "Résolu", cloture: "Clôturé" };
export const ISSUE_NEXT = { ouvert: ["affecte", "en_cours"], affecte: ["en_cours", "ouvert"], en_cours: ["a_verifier"], a_verifier: ["resolu", "en_cours"], resolu: ["cloture", "en_cours"], cloture: ["ouvert"] };
export const ISSUE_CATEGORY = { reserve: "Réserve", incident: "Incident", non_conformite: "Non-conformité", observation: "Observation" };
export const ROLE_LABEL = {
  admin_plateforme: "Administrateur plateforme", chef_projet: "Chef de projet", bim_manager: "BIM manager",
  conducteur_travaux: "Conducteur de travaux", sous_traitant: "Sous-traitant", lecteur: "Lecteur",
};
const WRITE_ROLES = ["admin_plateforme", "chef_projet", "bim_manager", "conducteur_travaux"];
export const canWrite = (role) => WRITE_ROLES.includes(role);
export const canLink = (role) => ["admin_plateforme", "chef_projet", "bim_manager"].includes(role);

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const parseD = (s) => new Date(`${s}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(parseD(s).getTime() + n * 86400000));
export const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
export const fmtD = (s) => {
  if (!s) return "—";
  const d = parseD(s);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const fmtShort = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "—");
export const fmtDT = (s) => (s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
export const monthLabel = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export function isWorking(s, cal) {
  const ex = (cal?.exceptions || []).find((e) => e.date === s);
  if (ex) return ex.type === "ouvre";
  const wd = (parseD(s).getUTCDay() + 6) % 7;
  return (cal?.working_days || [0, 1, 2, 3, 4]).includes(wd);
}

export function workingDaysBetween(a, b, cal) {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWorking(d, cal)) n += 1;
  return n;
}
