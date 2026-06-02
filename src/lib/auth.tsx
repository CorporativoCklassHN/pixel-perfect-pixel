import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { KEYS, lsGet, lsSet, initSeed, type Role, type User } from "./store";

type AuthCtx = {
  user: User | null;
  role: Role | null;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  refresh: () => void;
  hasPerm: (perm: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);

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
    const onStorage = () => refresh();
    window.addEventListener("ckl:storage", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ckl:storage", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const login = (email: string, password: string): boolean => {
    const users = lsGet<User[]>(KEYS.users, []);
    const u = users.find(
      (x) => x.correo.toLowerCase() === email.toLowerCase() && x.password === password && x.activo,
    );
    if (!u) return false;
    lsSet(KEYS.user, u);
    refresh();
    return true;
  };

  const logout = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(KEYS.user);
      window.dispatchEvent(new CustomEvent("ckl:storage", { detail: { key: KEYS.user } }));
    }
    setUser(null);
    setRole(null);
  };

  const hasPerm = (perm: string) => !!role?.permisos[perm];

  return <Ctx.Provider value={{ user, role, login, logout, refresh, hasPerm }}>{children}</Ctx.Provider>;
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
