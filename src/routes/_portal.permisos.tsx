import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth, useLocalStorage } from "@/lib/auth";
import { KEYS, type Role } from "@/lib/store";

export const Route = createFileRoute("/_portal/permisos")({
  head: () => ({ meta: [{ title: "Permisos — CKL" }] }),
  component: Permisos,
});

const MODULOS: { key: string; label: string }[] = [
  { key: "solicitar", label: "Solicitar viáticos" },
  { key: "ver_propio", label: "Ver propios" },
  { key: "comprobar", label: "Comprobar" },
  { key: "validar_comprobacion", label: "Validar comprobaciones" },
  { key: "revisar_monto_manual", label: "Revisar montos manuales de hotel" },
  { key: "gestionar_convenios", label: "Gestionar convenios con hoteles" },
  { key: "ver_equipo", label: "Ver equipo" },
  { key: "ver_todo", label: "Ver todo" },
  { key: "autorizar_lte5000", label: "Autorizar ≤ umbral" },
  { key: "autorizar_gt5000", label: "Autorizar > umbral" },
  { key: "rechazar", label: "Rechazar" },
  { key: "subir_comprobantes_viaje", label: "Subir comprobantes viaje" },
  { key: "ver_reportes", label: "Ver reportes" },
  { key: "exportar_reportes", label: "Exportar reportes" },
  { key: "gestionar_usuarios", label: "Gestionar usuarios" },
  { key: "configurar_permisos", label: "Configurar permisos" },
  { key: "configurar_montos", label: "Configurar montos" },
];

function Permisos() {
  const { hasPerm } = useAuth();
  const [roles, setRoles] = useLocalStorage<Role[]>(KEYS.roles, []);
  const [draft, setDraft] = useState<Role[]>(roles);

  if (!hasPerm("configurar_permisos")) {
    return <div className="ckl-card p-8 text-center text-sm">Sin permiso para acceder.</div>;
  }

  const toggle = (rid: number, key: string) => {
    setDraft((arr) => arr.map((r) => r.id === rid ? { ...r, permisos: { ...r.permisos, [key]: !r.permisos[key] } } : r));
  };

  const save = () => {
    setRoles(draft);
    toast.success("Permisos actualizados.");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm" style={{ background: "#DBEAFE", color: "#1D4ED8" }}>
        Configura la matriz de permisos por rol. Los cambios aplican inmediatamente al guardar.
      </div>
      <div className="ckl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Módulo</th>
                {draft.map((r) => <th key={r.id} className="p-3 text-center">{r.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {MODULOS.map((m) => (
                <tr key={m.key} className="border-t">
                  <td className="p-3 font-medium">{m.label}</td>
                  {draft.map((r) => (
                    <td key={r.id} className="p-3 text-center">
                      <button onClick={() => toggle(r.id, m.key)} className="relative inline-flex h-5 w-9 items-center rounded-full" style={{ background: r.permisos[m.key] ? "var(--color-primary)" : "#ccc" }}>
                        <span className="inline-block h-4 w-4 rounded-full bg-white" style={{ transform: r.permisos[m.key] ? "translateX(18px)" : "translateX(2px)" }} />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-end"><button onClick={save} className="ckl-btn-primary">Guardar cambios</button></div>
    </div>
  );
}
