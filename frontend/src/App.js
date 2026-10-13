import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import AppShell from "@/components/layout/AppShell";
import { Loading } from "@/components/common";
import LoginPage from "@/pages/LoginPage";
import ProjectsPage from "@/pages/ProjectsPage";
import OverviewPage from "@/pages/OverviewPage";
import PlanningPage from "@/pages/PlanningPage";
import ModelsPage from "@/pages/ModelsPage";
import Bim4DPage from "@/pages/Bim4DPage";
import CalendarPage from "@/pages/CalendarPage";
import AuditPage from "@/pages/AuditPage";

const Protected = ({ children }) => {
  const { user } = useAuth();
  if (user === null) return <Loading label="Vérification de la session…" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected><AppShell /></Protected>}>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:pid" element={<OverviewPage />} />
            <Route path="/projects/:pid/planning" element={<PlanningPage />} />
            <Route path="/projects/:pid/models" element={<ModelsPage />} />
            <Route path="/projects/:pid/4d" element={<Bim4DPage />} />
            <Route path="/projects/:pid/calendar" element={<CalendarPage />} />
            <Route path="/projects/:pid/audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
        <Toaster theme="light" position="bottom-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
