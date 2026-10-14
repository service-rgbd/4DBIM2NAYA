import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const qc = useQueryClient();

  useEffect(() => {
    api.get("/auth/me").then((r) => setUser(r.data)).catch(() => api.post("/auth/refresh").then(() => api.get("/auth/me")).then((r) => setUser(r.data)).catch(() => setUser(false)));
    const onExpired = () => setUser(false);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  }, []);
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    setUser(false);
  }, [qc]);
  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
