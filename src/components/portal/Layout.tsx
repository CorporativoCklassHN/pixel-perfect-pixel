import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, FilePlus2, ListChecks, ReceiptText, BarChart3,
  Users, ShieldCheck, Settings, LogOut, Menu, Bell, Plus, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { KEYS, lsGet, type Solicitud } from "@/lib/store";
import cklassLogo from "@/cklass-logo.png";

type Item = { to: string; label: string; icon: React.ComponentType<{ size?: number }>; perm?: string; section: string; badge?: number };

export function PortalLayout() {
  const { user, role, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) nav({ to: "/login" });
  }, [user, nav]);

  if (!user || !role) return null;

  const solicitudes = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  const abiertos = solicitudes.filter((s) => s.estatus === "Abierto").length;

  const items: Item[] = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "General" },
    { to: "/solicitar", label: "Solicitar viáticos", icon: FilePlus2, section: "Viáticos", perm: "solicitar" },
    { to: "/estatus", label: "Estatus", icon: ListChecks, section: "Viáticos", badge: abiertos },
    { to: "/comprobacion", label: "Comprobación", icon: ReceiptText, section: "Viáticos", perm: "comprobar" },
    { to: "/reportes", label: "Reportes", icon: BarChart3, section: "Viáticos", perm: "ver_reportes" },
    { to: "/usuarios", label: "Usuarios", icon: Users, section: "Administración" },
    { to: "/permisos", label: "Permisos", icon: ShieldCheck, section: "Administración", perm: "configurar_permisos" },
    { to: "/configuracion", label: "Configuración", icon: Settings, section: "Administración", perm: "configurar_montos" },
  ];

  const filtered = items.filter((i) => {
    // El rol Administrador no solicita ni comprueba sus propios viáticos.
    if (role.nombre === "administrador" && (i.to === "/solicitar" || i.to === "/comprobacion")) return false;
    if (i.to === "/usuarios") return role.permisos.ver_todo || role.permisos.ver_equipo;
    if (!i.perm) return true;
    return role.permisos[i.perm];
  });

  const sections = ["General", "Viáticos", "Administración"] as const;

  const current = filtered.find((i) => loc.pathname.startsWith(i.to));

  const Sidebar = (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r" style={{ background: "var(--color-sidebar)", borderColor: "var(--color-sidebar-border)" }}>
      <div className="flex items-center gap-3 p-4">
        <img src={cklassLogo} alt="Cklass" className="h-8 w-auto" />
        <div>
          <div className="text-sm font-semibold">Portal Viáticos</div>
          <div className="text-[11px] text-muted-foreground">CKLASS</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((sec) => {
          const its = filtered.filter((i) => i.section === sec);
          if (!its.length) return null;
          return (
            <div key={sec} className="mb-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{sec}</div>
              {its.map((i) => {
                const active = loc.pathname.startsWith(i.to);
                const Icon = i.icon;
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    onClick={() => setOpen(false)}
                    className="group flex items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
                    style={{
                      color: active ? "var(--color-primary)" : "#333333",
                      background: active ? "var(--color-primary-soft)" : "transparent",
                      borderLeft: active ? "3px solid var(--color-primary)" : "3px solid transparent",
                    }}
                  >
                    <Icon size={17} />
                    <span className="flex-1">{i.label}</span>
                    {i.badge && i.badge > 0 ? (
                      <span className="ckl-badge" style={{ background: "var(--color-primary)", color: "white", padding: "1px 6px" }}>{i.badge}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: "var(--color-sidebar-border)" }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: "var(--color-primary)" }}>
          {user.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{user.nombre}</div>
          <div className="truncate text-[10px] text-muted-foreground">{role.nombre}</div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:flex">{Sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 h-full">{Sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-white px-3 sm:gap-3 sm:px-4">
          <button className="shrink-0 lg:hidden" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="hidden text-[11px] text-muted-foreground sm:block">
              Portal &nbsp;/&nbsp; {current?.section ?? "—"}
            </div>
            <div className="truncate text-sm font-semibold">{current?.label ?? "Inicio"}</div>
          </div>
          <button
            onClick={() => {
              logout();
              nav({ to: "/login" });
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold hover:bg-secondary"
            style={{ color: "var(--color-primary)" }}
            title="Cerrar sesión"
          >
            <LogOut size={15} /> <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
          <button className="shrink-0 rounded-md p-2 hover:bg-secondary" title="Notificaciones">
            <Bell size={18} />
          </button>
          {role.permisos.solicitar && role.nombre !== "administrador" && (
            <Link to="/solicitar" className="ckl-btn-primary shrink-0" title="Nueva solicitud">
              <Plus size={15} /> <span className="hidden sm:inline">Nueva solicitud</span>
            </Link>
          )}
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-white p-10 text-center">
      <X size={28} className="text-muted-foreground" />
      <div className="mt-2 text-sm font-semibold">{title}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
