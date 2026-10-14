import { Link, NavLink, Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { Bell, Box, CalendarDays, ChevronRight, ClipboardCheck, Clock3, FolderKanban, GanttChart, History, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProject, useProjects, useDashboard } from "@/hooks/useProjectData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DemoBadge } from "@/components/common";
import { ROLE_LABEL, fmtD } from "@/lib/format";

const NAV = [
  { to: "", label: "Vue d'ensemble", icon: LayoutDashboard, id: "overview" },
  { to: "4d", label: "Espace BIM 4D", icon: Clock3, id: "bim4d", core: true },
  { to: "planning", label: "Planning Gantt", icon: GanttChart, id: "planning" },
  { to: "models", label: "Maquettes BIM", icon: Box, id: "models" },
  { to: "issues", label: "Réserves & incidents", icon: ClipboardCheck, id: "issues" },
  { to: "calendar", label: "Calendrier", icon: CalendarDays, id: "calendar" },
  { to: "audit", label: "Historique & audit", icon: History, id: "audit" },
];
const LATER = ["Documents & plans 2D", "Rapports journaliers", "Réunions", "Coûts", "Invitations & équipes"];

const Sidebar = ({ pid, onNav }) => (
  <aside className="flex h-full w-64 flex-col bg-slate-900 text-slate-100">
    <Link to="/projects" onClick={onNav} data-testid="sidebar-logo" className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
      <div className="grid h-8 w-8 place-items-center rounded bg-blue-600 font-heading text-sm font-extrabold">4D</div>
      <div className="font-heading text-lg font-bold tracking-tight">Chantier<span className="text-blue-400">4D</span></div>
    </Link>
    <nav className="flex-1 space-y-1 overflow-y-auto p-3 scroll-thin">
      <NavLink to="/projects" end onClick={onNav} data-testid="nav-projects" className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60"}`}>
        <FolderKanban className="h-4 w-4" />Projets
      </NavLink>
      {pid && <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Projet actif</div>}
      {pid && NAV.map((n) => (
        <NavLink key={n.id} to={`/projects/${pid}/${n.to}`} end={n.to === ""} onClick={onNav} data-testid={`nav-${n.id}`}
          className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800/60"}`}>
          <n.icon className="h-4 w-4" /><span className="flex-1">{n.label}</span>
          {n.core && <span className="rounded bg-blue-500/20 px-1.5 text-[10px] font-bold text-blue-300">CŒUR</span>}
        </NavLink>
      ))}
      <div className="px-3 pb-1 pt-6 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Modules prévus — non disponibles</div>
      {LATER.map((l) => <div key={l} className="cursor-not-allowed px-3 py-1.5 text-xs text-slate-500" title="Module non encore développé">{l}</div>)}
    </nav>
  </aside>
);

const Alerts = ({ pid }) => {
  const { data } = useDashboard(pid);
  const items = [...(data?.delayed || []), ...(data?.blocked || [])];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-testid="topbar-alerts-btn" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Alertes">
          <Bell className="h-5 w-5" />
          {items.length > 0 && <span data-testid="topbar-alerts-count" className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{items.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Alertes calculées du planning</div>
        <div className="max-h-72 overflow-y-auto">
          {items.length === 0 && <div className="p-4 text-sm text-slate-500">Aucune activité en retard ou bloquée.</div>}
          {items.map((t) => (
            <Link key={t.id} to={`/projects/${pid}/planning?task=${t.id}`} className="block border-b px-3 py-2 text-sm hover:bg-slate-50" data-testid={`alert-item-${t.code}`}>
              <div className="font-medium text-slate-800">{t.code} · {t.name}</div>
              <div className="text-xs text-red-600">{t.health === "bloque" ? "Bloquée" : `En retard — fin prévue ${fmtD(t.early_finish)}`}</div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const Topbar = ({ pid, onMenu }) => {
  const { user, logout } = useAuth();
  const { data: projects } = useProjects();
  const { data: project } = useProject(pid);
  const nav = useNavigate();
  const loc = useLocation();
  const section = NAV.find((n) => n.to && loc.pathname.endsWith(`/${n.to}`))?.label || (pid ? "Vue d'ensemble" : "Projets");
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-md md:px-6">
      <button className="rounded p-1.5 hover:bg-slate-100 lg:hidden" onClick={onMenu} data-testid="mobile-menu-btn" aria-label="Menu"><Menu className="h-5 w-5" /></button>
      <div className="hidden items-center gap-1 text-sm text-slate-500 md:flex" data-testid="breadcrumb">
        <Link to="/projects" className="hover:text-slate-900">Projets</Link>
        {project && <><ChevronRight className="h-3.5 w-3.5" /><span className="max-w-[220px] truncate text-slate-700">{project.reference}</span></>}
        {pid && <><ChevronRight className="h-3.5 w-3.5" /><span className="font-medium text-slate-900">{section}</span></>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {projects?.length > 0 && (
          <Select value={pid || ""} onValueChange={(v) => nav(`/projects/${v}`)}>
            <SelectTrigger data-testid="project-switcher" className="h-9 w-[200px] md:w-[280px]"><SelectValue placeholder="Choisir un projet" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id} data-testid={`project-switcher-item-${p.reference}`}>{p.is_demo ? "[DÉMO] " : ""}{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {project?.is_demo && <DemoBadge />}
        {pid && <Alerts pid={pid} />}
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-medium text-slate-800" data-testid="topbar-user-name">{user?.name}</div>
          <div className="text-[11px] text-slate-500">{ROLE_LABEL[project?.my_role] || user?.email}</div>
        </div>
        <button data-testid="logout-btn" onClick={logout} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title="Se déconnecter"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
};

export default function AppShell() {
  const { pid } = useParams();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <div className="hidden lg:block"><Sidebar pid={pid} /></div>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <Sidebar pid={pid} onNav={() => setOpen(false)} />
          <button className="flex-1 bg-slate-900/50" onClick={() => setOpen(false)} data-testid="mobile-menu-close" aria-label="Fermer"><X className="ml-auto mr-4 mt-4 h-6 w-6 text-white" /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar pid={pid} onMenu={() => setOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto scroll-thin"><Outlet /></main>
      </div>
    </div>
  );
}
