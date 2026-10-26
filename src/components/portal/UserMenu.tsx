import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Eye, EyeOff, KeyRound, LogOut, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cambiarContrasena, evaluarContrasena, PASSWORD_MIN_LENGTH } from "@/lib/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// "jefe_inmediato" → "Jefe inmediato"
function etiquetaRol(nombre: string) {
  const t = nombre.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Menú del usuario en el encabezado: nombre + rol, y al hacer clic las opciones
// Cerrar sesión / Cambiar contraseña.
export function UserMenu() {
  const { user, role, logout } = useAuth();
  const nav = useNavigate();
  const [cambiando, setCambiando] = useState(false);
  if (!user || !role) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-secondary focus:outline-none sm:px-2"
            aria-label="Menú de usuario"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ background: "var(--color-primary)" }}
            >
              {user.initials}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-[160px] truncate text-sm font-semibold leading-tight">
                {user.nombre}
              </span>
              <span className="block max-w-[160px] truncate text-[11px] leading-tight text-muted-foreground">
                {etiquetaRol(role.nombre)}
              </span>
            </span>
            <ChevronDown size={14} className="hidden text-muted-foreground sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-semibold">{user.nombre}</div>
            <div className="text-xs text-muted-foreground">{etiquetaRol(role.nombre)}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{user.empresa}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2 py-2.5"
            onSelect={() => {
              logout();
              nav({ to: "/login" });
            }}
          >
            <LogOut size={16} style={{ color: "var(--color-primary)" }} /> Cerrar sesión
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 py-2.5"
            onSelect={() => setCambiando(true)}
          >
            <KeyRound size={16} className="text-muted-foreground" /> Cambiar contraseña
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {cambiando && <CambiarContrasenaDialog onClose={() => setCambiando(false)} />}
    </>
  );
}

function CambiarContrasenaDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver, setVer] = useState(false);
  const [errorActual, setErrorActual] = useState("");
  if (!user) return null;

  const reglas = evaluarContrasena(nueva, user);
  const coincide = confirmar.length > 0 && nueva === confirmar;
  const distintaDeActual = nueva.length === 0 || nueva !== actual;
  const valido =
    actual.length > 0 && reglas.longitud && reglas.noComun && coincide && distintaDeActual;

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    const r = cambiarContrasena(user.id, actual, nueva);
    if (r === "actual_incorrecta") {
      setErrorActual("La contraseña actual no es correcta.");
      return;
    }
    if (r !== "ok") {
      setErrorActual("No se pudo actualizar la contraseña.");
      return;
    }
    toast.success("Contraseña actualizada.");
    onClose();
  };

  const campo = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    autoComplete: string,
  ) => (
    <div>
      <label className="ckl-label">{label}</label>
      <input
        type={ver ? "text" : "password"}
        className="ckl-input"
        style={{ borderRadius: 999, padding: "12px 18px" }}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setErrorActual("");
        }}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
    </div>
  );

  const Regla = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <li className="flex items-center gap-2 text-sm" style={{ color: ok ? "#228B22" : "#555" }}>
      {ok ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      {children}
    </li>
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        className="ckl-card max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto p-6"
        style={{ borderRadius: 20 }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Configuración de seguridad</h3>
          <span
            className="ckl-badge shrink-0"
            style={{ background: "#D8F3DC", color: "#2D6A4F", borderRadius: 999, padding: "5px 12px" }}
          >
            Sesión activa
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Actualiza tu contraseña para mantener segura tu cuenta.
        </p>

        {campo("Contraseña actual", actual, setActual, "Ingresa tu contraseña actual", "current-password")}
        {errorActual && (
          <p className="-mt-2 text-xs font-medium" style={{ color: "var(--color-primary)" }}>
            {errorActual}
          </p>
        )}
        {campo("Nueva contraseña", nueva, setNueva, "Ingresa tu nueva contraseña", "new-password")}
        {campo(
          "Confirmar nueva contraseña",
          confirmar,
          setConfirmar,
          "Confirma tu nueva contraseña",
          "new-password",
        )}

        <button
          type="button"
          onClick={() => setVer((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
        >
          {ver ? <EyeOff size={14} /> : <Eye size={14} />} {ver ? "Ocultar" : "Mostrar"} contraseñas
        </button>

        <ul className="space-y-2 px-1">
          <Regla ok={reglas.longitud}>Usa al menos {PASSWORD_MIN_LENGTH} caracteres</Regla>
          <Regla ok={reglas.noComun}>Evita contraseñas comunes o comprometidas</Regla>
          <Regla ok={coincide}>La confirmación coincide con la nueva contraseña</Regla>
          {nueva.length > 0 && !distintaDeActual && (
            <li className="text-xs" style={{ color: "var(--color-primary)" }}>
              La nueva contraseña debe ser distinta de la actual.
            </li>
          )}
        </ul>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="submit"
            disabled={!valido}
            className="ckl-btn-primary w-full justify-center"
            style={{ borderRadius: 999, padding: "13px 16px" }}
          >
            Actualizar contraseña
          </button>
          <button type="button" onClick={onClose} className="ckl-btn-ghost w-full justify-center">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
