import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { KEYS, lsGet, lsSet, initSeed, findUserByIdentifier, uid, type Role, type User, type SessionInfo } from "./store";
import { showErrorDialog } from "@/components/ErrorDialog";

type AuthCtx = {
  user: User | null;
  role: Role | null;
  // true hasta que se leyó la sesión guardada (primer render en el cliente).
  cargando: boolean;
  login: (identifier: string, password: string) => boolean;
  logout: () => void;
  refresh: () => void;
  hasPerm: (perm: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // La sesión se lee de localStorage en un efecto (no en el inicializador de useState):
  // el servidor renderiza sin sesión y leerla síncronamente en el cliente rompería la
  // hidratación. `cargando` evita que el layout redirija a /login en ese primer render
  // (antes un F5 o una URL directa siempre terminaban en el Dashboard).
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [cargando, setCargando] = useState(true);
  // La sesión (token) que esta pestaña considera "propia". Si en localStorage
  // aparece un token distinto para el mismo usuario, significa que se inició
  // sesión en otro lugar con esa misma cuenta y esta pestaña debe cerrarse.
  const sessionRef = useRef<SessionInfo | null>(null);

  const refresh = () => {
    const u = lsGet<User | null>(KEYS.user, null);
    setUser(u);
    if (u) {
      const roles = lsGet<Role[]>(KEYS.roles, []);
      setRole(roles.find((r) => r.id === u.rol_id) ?? null);
    } else {
      setRole(null);
    }
  };

  useEffect(() => {
    initSeed();
    refresh();
    setCargando(false);
    // Al montar (recarga de página), adopta la sesión ya guardada como propia.
    const u = lsGet<User | null>(KEYS.user, null);
    const sess = lsGet<SessionInfo | null>(KEYS.session, null);
    if (u && sess && sess.userId === u.id) sessionRef.current = sess;

    const onStorage = () => {
      const mine = sessionRef.current;
      if (mine) {
        const current = lsGet<SessionInfo | null>(KEYS.session, null);
        if (current && current.userId === mine.userId && current.token !== mine.token) {
          sessionRef.current = null;
          window.localStorage.removeItem(KEYS.user);
          setUser(null);
          setRole(null);
          showErrorDialog("Tu sesión se cerró porque este usuario inició sesión en otro lugar.");
          return;
        }
      }
      refresh();
    };
    window.addEventListener("ckl:storage", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ckl:storage", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const login = (identifier: string, password: string): boolean => {
    const u = findUserByIdentifier(identifier);
    if (!u || u.password !== password || !u.activo) return false;
    // Genera el token ANTES de escribirlo: lsSet dispara el evento ckl:storage de
    // forma síncrona incluso en esta misma pestaña, así que la ref ya debe
    // coincidir para no auto-cerrar la sesión que se acaba de abrir.
    const session: SessionInfo = { userId: u.id, token: uid("sess_") };
    sessionRef.current = session;
    lsSet(KEYS.session, session);
    lsSet(KEYS.user, u);
    refresh();
    return true;
  };

  const logout = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(KEYS.user);
      window.localStorage.removeItem(KEYS.session);
      window.dispatchEvent(new CustomEvent("ckl:storage", { detail: { key: KEYS.user } }));
    }
    sessionRef.current = null;
    setUser(null);
    setRole(null);
  };

  const hasPerm = (perm: string) => !!role?.permisos[perm];

  return <Ctx.Provider value={{ user, role, cargando, login, logout, refresh, hasPerm }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => lsGet<T>(key, defaultValue));
  useEffect(() => {
    const onStorage = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.key === key) setVal(lsGet<T>(key, defaultValue));
    };
    window.addEventListener("ckl:storage", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ckl:storage", onStorage);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (v: T) => {
    lsSet(key, v);
    setVal(v);
  };
  return [val, update];
}
