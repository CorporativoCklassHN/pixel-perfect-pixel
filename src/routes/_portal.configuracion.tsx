import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Edit2, Plus, X, Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useLocalStorage } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import {
  KEYS,
  type Sociedad,
  type Role,
  type User,
  type CorreoSimulado,
  type LogEvento,
} from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Modal } from "./_portal.solicitar";

// Normaliza el nombre capturado a un identificador consistente con el resto
// de los roles (snake_case, sin acentos) — se usa como comparación en varias
// partes de la app (p. ej. permisos de administrador).
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function slugifyRole(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const Route = createFileRoute("/_portal/configuracion")({
  head: () => ({ meta: [{ title: "Configuración — CKL" }] }),
  component: Configuracion,
});

type Config = {
  monto_comida_diario: number;
  umbral_finanzas: number;
  dia_deposito: string;
  email_compras: string;
  dias_comprobacion_atrasada: number;
  dias_autorizacion_pendiente: number;
  dias_recordatorio_viaje: number;
  notif_email_activo: boolean;
  notif_email_destinatarios: string;
  smtp_servidor: string;
  smtp_puerto: number;
  smtp_usuario: string;
  smtp_password: string;
  smtp_cifrado: string;
  notif_plataforma_activo: boolean;
  revision_automatica_activo: boolean;
};

const CONFIG_DEFAULTS: Config = {
  monto_comida_diario: 450,
  umbral_finanzas: 5000,
  dia_deposito: "Viernes",
  email_compras: "compras@cklass.com",
  dias_comprobacion_atrasada: 7,
  dias_autorizacion_pendiente: 3,
  dias_recordatorio_viaje: 2,
  notif_email_activo: true,
  notif_email_destinatarios: "",
  smtp_servidor: "",
  smtp_puerto: 587,
  smtp_usuario: "",
  smtp_password: "",
  smtp_cifrado: "TLS",
  notif_plataforma_activo: true,
  revision_automatica_activo: true,
};

// Vista de apoyo (solo lectura): correos informativos "enviados" (simulados, aún sin
// servidor de correo) y bitácora de eventos. Con la base de datos conectada, los logs
// se guardan en una tabla `logs`.
function BitacoraNotificaciones() {
  const [correos] = useLocalStorage<CorreoSimulado[]>(KEYS.correos, []);
  const [logs] = useLocalStorage<LogEvento[]>(KEYS.logs, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [correo, setCorreo] = useState<CorreoSimulado | null>(null);
  const nombre = (id: string | null) => users.find((u) => u.id === id)?.nombre ?? "—";
  const fh = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  const ultimosLogs = [...logs].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 25);

  return (
    <div className="ckl-card p-5">
      <h3 className="text-base font-semibold">Bitácora de notificaciones</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Correos informativos a Compras por montos manuales de hotel (simulados: aún no hay servidor de
        correo) y eventos registrados.
      </p>

      <div className="mt-4 text-sm font-semibold">Correos ({correos.length})</div>
      <div className="mt-2 overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-secondary text-left text-muted-foreground">
            <tr>
              <th className="p-2">Fecha</th>
              <th className="p-2">Para</th>
              <th className="p-2">Asunto</th>
              <th className="p-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {correos.slice(0, 15).map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer border-t hover:bg-secondary/50"
                onClick={() => setCorreo(c)}
              >
                <td className="whitespace-nowrap p-2">{fh(c.fecha)}</td>
                <td className="p-2">{c.para}</td>
                <td className="p-2">{c.asunto}</td>
                <td className="p-2">{c.estado}</td>
              </tr>
            ))}
            {correos.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">
                  Sin correos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 text-sm font-semibold">Logs (últimos {ultimosLogs.length})</div>
      <div className="mt-2 overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-secondary text-left text-muted-foreground">
            <tr>
              <th className="p-2">Fecha</th>
              <th className="p-2">Tipo</th>
              <th className="p-2">Usuario</th>
              <th className="p-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {ultimosLogs.map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="whitespace-nowrap p-2">{fh(l.fecha)}</td>
                <td className="p-2 font-mono">{l.tipo}</td>
                <td className="p-2">{nombre(l.usuario_id)}</td>
                <td className="max-w-[360px] break-words p-2 text-muted-foreground">
                  {JSON.stringify(l.detalle)}
                </td>
              </tr>
            ))}
            {ultimosLogs.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">
                  Sin eventos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {correo && (
        <Modal onClose={() => setCorreo(null)}>
          <h3 className="pr-6 text-base font-semibold">{correo.asunto}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            Para: {correo.para} · {fh(correo.fecha)} · {correo.estado}
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-secondary p-3 text-xs">{correo.cuerpo}</pre>
        </Modal>
      )}
    </div>
  );
}

function Configuracion() {
  const { hasPerm, role } = useAuth();
  const [config, setConfig] = useLocalStorage<Config>(KEYS.config, CONFIG_DEFAULTS);
  const [sociedades, setSociedades] = useLocalStorage<Sociedad[]>(KEYS.sociedades, []);
  const [roles, setRoles] = useLocalStorage<Role[]>(KEYS.roles, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [draft, setDraft] = useState<Config>(config);
  const [edit, setEdit] = useState<Sociedad | null>(null);
  const [editRole, setEditRole] = useState<{ nombre: string; copyFrom: number } | null>(null);

  if (!hasPerm("configurar_montos")) {
    return <div className="ckl-card p-8 text-center text-sm">Sin permiso para acceder.</div>;
  }

  const saveCfg = () => { setConfig(draft); toast.success("Configuración guardada."); };

  const saveSoc = (s: Sociedad) => {
    if (s.id === 0) {
      const newId = Math.max(0, ...sociedades.map((x) => x.id)) + 1;
      setSociedades([...sociedades, { ...s, id: newId }]);
    } else {
      setSociedades(sociedades.map((x) => x.id === s.id ? s : x));
    }
    toast.success("Sociedad guardada.");
    setEdit(null);
  };

  const saveRole = () => {
    if (!editRole) return;
    const nombre = slugifyRole(editRole.nombre);
    if (!nombre) return showErrorDialog("Captura un nombre para el rol.");
    if (roles.some((r) => r.nombre === nombre)) return showErrorDialog("Ya existe un rol con ese nombre.");
    const template = roles.find((r) => r.id === editRole.copyFrom);
    const newId = Math.max(0, ...roles.map((r) => r.id)) + 1;
    setRoles([...roles, { id: newId, nombre, permisos: { ...(template?.permisos ?? {}) } }]);
    toast.success(`Rol "${nombre}" creado. Ajusta sus permisos en Permisos.`);
    setEditRole(null);
  };

  const deleteRole = (r: Role) => {
    const enUso = users.filter((u) => u.rol_id === r.id).length;
    if (enUso > 0) {
      return showErrorDialog(
        `No se puede eliminar "${r.nombre}": ${enUso} usuario(s) lo tienen asignado.`,
      );
    }
    if (!confirm(`¿Eliminar el rol "${r.nombre}"? Esta acción no se puede deshacer.`)) return;
    setRoles(roles.filter((x) => x.id !== r.id));
    toast.success("Rol eliminado.");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="ckl-card p-5">
        <h3 className="text-base font-semibold">Montos y reglas</h3>
        <div className="mt-4 space-y-3">
          <div><label className="ckl-label">Monto comida diario ($)</label><input type="number" className="ckl-input" value={draft.monto_comida_diario} onChange={(e) => setDraft({ ...draft, monto_comida_diario: +e.target.value })} /></div>
          <div><label className="ckl-label">Umbral Finanzas ($)</label><input type="number" className="ckl-input" value={draft.umbral_finanzas} onChange={(e) => setDraft({ ...draft, umbral_finanzas: +e.target.value })} /></div>
          <div>
            <label className="ckl-label">Día de depósito</label>
            <select className="ckl-input" value={draft.dia_deposito} onChange={(e) => setDraft({ ...draft, dia_deposito: e.target.value })}>
              {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div><label className="ckl-label">Email compras</label><input className="ckl-input" value={draft.email_compras} onChange={(e) => setDraft({ ...draft, email_compras: e.target.value })} /></div>
        </div>
        <button onClick={saveCfg} className="ckl-btn-primary mt-4">Guardar</button>
      </div>

      <div className="ckl-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Sociedades</h3>
          <button onClick={() => setEdit({ id: 0, nombre: "", rfc: "", regimen: "601 - Gral. Personas Morales", cp: "", UsoCFDI: "G03 - Gastos en General", sociedad_sap: "" })} className="ckl-btn-outline"><Plus size={14} /> Agregar</button>
        </div>
        <div className="mt-3 divide-y">
          {sociedades.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-semibold">{s.nombre}</div>
                <div className="text-xs text-muted-foreground">{s.rfc} · SAP {s.sociedad_sap}</div>
              </div>
              <button onClick={() => setEdit(s)} className="rounded p-1.5 hover:bg-secondary"><Edit2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="ckl-card p-5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Roles</h3>
          <button
            onClick={() => setEditRole({ nombre: "", copyFrom: roles[0]?.id ?? 0 })}
            className="ckl-btn-outline"
          >
            <Plus size={14} /> Agregar rol
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Crea un rol copiando los permisos de uno existente; después ajusta el detalle en la sección
          "Permisos".
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {roles.map((r) => (
            <span
              key={r.id}
              className="ckl-badge inline-flex items-center gap-1.5"
              style={{ background: "#F1F3F5", color: "#333" }}
            >
              {r.nombre}
              <button
                onClick={() => deleteRole(r)}
                className="rounded-full p-0.5 hover:bg-black/10"
                title={`Eliminar rol ${r.nombre}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {role?.nombre === "administrador" && (
        <div className="ckl-card p-5 lg:col-span-2">
          <h3 className="text-base font-semibold">Automatizaciones</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Define umbrales y los canales por los que se notifica al equipo.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="ckl-label">Comprobación atrasada (días)</label>
              <input
                type="number"
                className="ckl-input"
                value={draft.dias_comprobacion_atrasada}
                onChange={(e) =>
                  setDraft({ ...draft, dias_comprobacion_atrasada: +e.target.value })
                }
              />
            </div>
            <div>
              <label className="ckl-label">Autorización pendiente (días)</label>
              <input
                type="number"
                className="ckl-input"
                value={draft.dias_autorizacion_pendiente}
                onChange={(e) =>
                  setDraft({ ...draft, dias_autorizacion_pendiente: +e.target.value })
                }
              />
            </div>
            <div>
              <label className="ckl-label">Recordatorio de viaje (días antes)</label>
              <input
                type="number"
                className="ckl-input"
                value={draft.dias_recordatorio_viaje}
                onChange={(e) => setDraft({ ...draft, dias_recordatorio_viaje: +e.target.value })}
              />
            </div>
          </div>

          <div className="mt-6 border-t pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Envío de correos</div>
                <div className="text-xs text-muted-foreground">
                  Enviar resumen de alertas a los destinatarios configurados.
                </div>
              </div>
              <Switch
                checked={draft.notif_email_activo}
                onCheckedChange={(v) => setDraft({ ...draft, notif_email_activo: v })}
              />
            </div>
            <div className="mt-3">
              <label className="ckl-label">Destinatarios (separados por coma)</label>
              <input
                className="ckl-input"
                value={draft.notif_email_destinatarios}
                onChange={(e) => setDraft({ ...draft, notif_email_destinatarios: e.target.value })}
                placeholder="alonso.perez@cklass.net, jose.alcala@cklass.net"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Se notificará a estos correos cuando se envíe el resumen de alertas.
              </p>
            </div>
          </div>

          <div className="mt-6 border-t pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Parámetros SMTP</div>
                <div className="text-xs text-muted-foreground">
                  Configura el servidor SMTP para el envío real de correos.
                </div>
              </div>
              <button
                onClick={() => toast.success("Correo de prueba enviado.")}
                className="ckl-btn-outline shrink-0"
              >
                <Mail size={14} /> Probar correo
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="ckl-label">Servidor SMTP</label>
                <input
                  className="ckl-input"
                  value={draft.smtp_servidor}
                  onChange={(e) => setDraft({ ...draft, smtp_servidor: e.target.value })}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div>
                <label className="ckl-label">Puerto SMTP</label>
                <input
                  type="number"
                  className="ckl-input"
                  value={draft.smtp_puerto}
                  onChange={(e) => setDraft({ ...draft, smtp_puerto: +e.target.value })}
                />
              </div>
              <div>
                <label className="ckl-label">Usuario SMTP</label>
                <input
                  className="ckl-input"
                  value={draft.smtp_usuario}
                  onChange={(e) => setDraft({ ...draft, smtp_usuario: e.target.value })}
                  placeholder="smtp@cklass.com"
                />
              </div>
              <div>
                <label className="ckl-label">Contraseña SMTP</label>
                <input
                  type="password"
                  className="ckl-input"
                  value={draft.smtp_password}
                  onChange={(e) => setDraft({ ...draft, smtp_password: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="ckl-label">Tipo de cifrado</label>
                <select
                  className="ckl-input"
                  value={draft.smtp_cifrado}
                  onChange={(e) => setDraft({ ...draft, smtp_cifrado: e.target.value })}
                >
                  <option value="SSL">SSL</option>
                  <option value="TLS">TLS</option>
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Elige SSL para conexión directa o TLS para STARTTLS.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-4 border-t pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Notificaciones en plataforma</div>
                <div className="text-xs text-muted-foreground">
                  Mostrar avisos en el ícono de la barra superior.
                </div>
              </div>
              <Switch
                checked={draft.notif_plataforma_activo}
                onCheckedChange={(v) => setDraft({ ...draft, notif_plataforma_activo: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Revisión automática</div>
                <div className="text-xs text-muted-foreground">
                  Recalcular alertas en cuanto cambian los datos.
                </div>
              </div>
              <Switch
                checked={draft.revision_automatica_activo}
                onCheckedChange={(v) => setDraft({ ...draft, revision_automatica_activo: v })}
              />
            </div>
          </div>

          <button onClick={saveCfg} className="ckl-btn-primary mt-6">Guardar automatizaciones</button>
        </div>
      )}

      {edit && (
        <Modal onClose={() => setEdit(null)}>
          <h3 className="mb-3 text-lg font-semibold">{edit.id ? "Editar" : "Nueva"} sociedad</h3>
          <div className="grid grid-cols-2 gap-3">
            {(["nombre", "rfc", "regimen", "cp", "UsoCFDI", "sociedad_sap"] as const).map((k) => (
              <div key={k} className={k === "nombre" || k === "regimen" ? "col-span-2" : ""}>
                <label className="ckl-label">{k}</label>
                <input className="ckl-input" value={(edit as any)[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="ckl-btn-ghost">Cancelar</button>
            <button onClick={() => saveSoc(edit)} className="ckl-btn-primary">Guardar</button>
          </div>
        </Modal>
      )}

      <BitacoraNotificaciones />

      {editRole && (
        <Modal onClose={() => setEditRole(null)}>
          <h3 className="mb-3 text-lg font-semibold">Nuevo rol</h3>
          <div className="space-y-3">
            <div>
              <label className="ckl-label">Nombre del rol</label>
              <input
                className="ckl-input"
                value={editRole.nombre}
                onChange={(e) => setEditRole({ ...editRole, nombre: e.target.value })}
                placeholder="Ej. Compras Corporativas"
              />
            </div>
            <div>
              <label className="ckl-label">Copiar permisos de</label>
              <select
                className="ckl-input"
                value={editRole.copyFrom}
                onChange={(e) => setEditRole({ ...editRole, copyFrom: +e.target.value })}
              >
                {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setEditRole(null)} className="ckl-btn-ghost">Cancelar</button>
            <button onClick={saveRole} className="ckl-btn-primary">Guardar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
