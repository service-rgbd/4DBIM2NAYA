import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { HEALTH } from "@/lib/format";

export const HealthBadge = ({ value, testid }) => {
  const h = HEALTH[value] || HEALTH.a_realiser;
  return <span data-testid={testid} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${h.cls}`}>{h.label}</span>;
};

export const DemoBadge = () => (
  <span data-testid="demo-badge" className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">Démo</span>
);

export const Loading = ({ label = "Chargement…" }) => (
  <div data-testid="loading-state" className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
);

export const ErrorState = ({ message, onRetry }) => (
  <div data-testid="error-state" className="m-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="flex-1">{message}</div>
    {onRetry && <button data-testid="error-retry-btn" onClick={onRetry} className="font-semibold underline">Réessayer</button>}
  </div>
);

export const EmptyState = ({ title, children, testid = "empty-state" }) => (
  <div data-testid={testid} className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
    <Inbox className="h-6 w-6 text-slate-400" />
    <div className="font-heading text-base font-semibold text-slate-800">{title}</div>
    <div className="max-w-md text-sm text-slate-500">{children}</div>
  </div>
);

export const Kpi = ({ label, value, sub, tone = "text-slate-900", testid }) => (
  <div data-testid={testid} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`mt-1 font-mono text-2xl font-bold ${tone}`}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
  </div>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Field = ({ label, error, children }) => (
  <label className="block space-y-1">
    <span className="text-xs font-semibold text-slate-600">{label}</span>
    {children}
    {error && <span className="block text-xs text-red-600">{error}</span>}
  </label>
);
