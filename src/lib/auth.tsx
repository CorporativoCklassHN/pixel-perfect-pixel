import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { showErrorDialog } from "@/components/ErrorDialog";

import { api, ApiError, AUTH_EVENT, type AuthEventDetail } from "./api";
import { POLL_MS } from "./queries";
import type { Role, User } from "./store";

type AuthCtx = {
  user: User | null;
  role: Role | null;
  // true hasta que se consultó la sesión en el servidor (primer render en el cliente).
  cargando: boolean;
  login: (identifier: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

type Me = { user: User; role: Role };
type MeResp = { user: User | null; role: Role | null };

export function AuthProvider({ children }: { children: ReactNode }) {
  // La sesión vive en el servidor (cookie httpOnly + tabla `sesiones`). Se consulta en un efecto,
  // no en el inicializador de useState: el servidor SSR renderiza sin sesión y leerla síncronamente
  // en el cliente rompería la hidratación. `cargando` evita redirigir a /login en ese primer render.
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [cargando, setCargando] = useState(true);
  const hayUsuario = useRef(false);

  const limpiar = useCallback(() => {
    hayUsuario.current = false;
    setUser(null);
    setRole(null);
    qc.clear();
  }, [qc]);

  const aplicar = useCallback((me: Me | null) => {
    hayUsuario.current = !!me;
    setUser(me?.user ?? null);
    setRole(me?.role ?? null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<MeResp>("/auth/me");
      if (!r.user && hayUsuario.current) limpiar();
      else aplicar(r.user && r.role ? { user: r.user, role: r.role } : null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "SESSION_REPLACED" && hayUsuario.current) {
        limpiar();
        showErrorDialog(e.message);
        return;
      }
      if (e instanceof ApiError && e.status === 401) {
        if (hayUsuario.current) limpiar();
        else aplicar(null);
      }
      // Errores de red: se conserva la sesión mostrada.
    }
  }, [aplicar, limpiar]);

  useEffect(() => {
    void refresh().finally(() => setCargando(false));
    const onAuth = (e: Event) => {
      const reason = (e as CustomEvent<AuthEventDetail>).detail?.reason;
      if (!hayUsuario.current) return;
      limpiar();
      if (reason === "session_replaced") {
        showErrorDialog("Tu sesión se cerró porque este usuario inició sesión en otro lugar.");
      }
    };
    window.addEventListener(AUTH_EVENT, onAuth);
    // Detecta el cierre por "sesión única" aunque el usuario no esté navegando.
    const t = window.setInterval(() => {
      if (hayUsuario.current) void refresh();
    }, POLL_MS);
    return () => {
      window.removeEventListener(AUTH_EVENT, onAuth);
      window.clearInterval(t);
    };
  }, [refresh, limpiar]);

  const login = async (identifier: string, password: string): Promise<boolean> => {
    try {
      const me = await api.post<Me>("/auth/login", { identifier, password });
      qc.clear();
      aplicar(me);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      throw e;
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Aunque falle la red, se cierra la sesión local.
    }
    limpiar();
  };

  const hasPerm = (perm: string) => !!role?.permisos[perm];

  return <Ctx.Provider value={{ user, role, cargando, login, logout, refresh, hasPerm }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
