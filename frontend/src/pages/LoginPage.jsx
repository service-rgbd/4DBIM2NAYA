import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/common";

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/projects" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      nav("/projects");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-slate-900 lg:block">
        <img src="https://images.unsplash.com/photo-1721244654394-36a7bc2da288?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2 font-heading text-xl font-bold"><div className="grid h-9 w-9 place-items-center rounded bg-blue-600 text-sm">4D</div>Chantier4D</div>
          <div className="max-w-lg">
            <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">La maquette IFC reliée au planning, jour après jour.</h1>
            <p className="mt-4 text-slate-300">Liaison objet-activité, chemin critique, simulation prévue et réelle : la coordination BIM 4D de vos chantiers.</p>
          </div>
          <div className="text-xs text-slate-400">Accès réservé aux comptes créés par l'administrateur.</div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 fade-up" data-testid="login-form">
          <div>
            <h2 className="font-heading text-2xl font-bold text-slate-900">Connexion</h2>
            <p className="mt-1 text-sm text-slate-500">Identifiez-vous pour accéder à vos projets.</p>
          </div>
          <Field label="Adresse e-mail"><Input data-testid="login-email-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Mot de passe"><Input data-testid="login-password-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <div data-testid="login-error" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <Button data-testid="login-submit-btn" type="submit" disabled={busy} className="w-full bg-blue-700 hover:bg-blue-800">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Se connecter
          </Button>
          <div className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" />Session sécurisée (cookies httpOnly, 5 tentatives max.)</div>
        </form>
      </div>
    </div>
  );
}
