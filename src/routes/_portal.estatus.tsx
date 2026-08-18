import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, MessageSquareWarning, Upload, Check, X, Edit2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useLocalStorage } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import {
  KEYS,
  fmtMoney,
  uid,
  filterSolicitudesByDateCutoff,
  type Solicitud,
  type User,
  type Autorizacion,
} from "@/lib/store";
import { StatusBadge } from "./_portal.dashboard";
import { Modal } from "./_portal.solicitar";

export const Route = createFileRoute("/_portal/estatus")({
  head: () => ({ meta: [{ title: "Estatus de viáticos — CKL" }] }),
  component: Estatus,
});

function Estatus() {
  const { user, role, hasPerm } = useAuth();
  const nav = useNavigate();
  const [solicitudes, setSolicitudes] = useLocalStorage<Solicitud[]>(KEYS.solicitudes, []);
  const [autorizaciones, setAutorizaciones] = useLocalStorage<Autorizacion[]>(KEYS.autorizaciones, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const config = JSON.parse(typeof window !== "undefined" ? localStorage.getItem(KEYS.config) ?? "{}" : "{}");
  const umbral = config.umbral_finanzas ?? 5000;

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("Todos");
  const [detail, setDetail] = useState<Solicitud | null>(null);
  const [rejecting, setRejecting] = useState<Solicitud | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const filtered = useMemo(() => {
    const dentroDeRango = filterSolicitudesByDateCutoff(solicitudes, role?.nombre);
    return dentroDeRango.filter((s) => {
      const u = users.find((x) => x.id === s.user_id);
      const matchQ = !q || s.folio.toLowerCase().includes(q.toLowerCase()) || (u?.nombre.toLowerCase().includes(q.toLowerCase()) ?? false);
      const matchE = estado === "Todos" || s.estatus === estado;
      return matchQ && matchE;
    });
  }, [solicitudes, q, estado, users, role]);

  const userName = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";

  const canEdit = (s: Solicitud) => s.user_id === user?.id && s.estatus === "Abierto" && !autorizaciones.find((a) => a.solicitud_id === s.id);

  const canAuth = (s: Solicitud) => {
    if (!role) return false;
    if (s.estatus !== "Abierto") return false;
    // El paso de Jefe siempre lo puede dar quien tenga el permiso, sin importar el
    // monto: el umbral solo decide si además se necesita un segundo visto bueno de
    // Finanzas, no si el propio Jefe puede autorizar. Antes exigir monto ≤ umbral
    // aquí dejaba las solicitudes de monto alto sin nadie que pudiera autorizarlas.
    if (role.permisos.autorizar_lte5000 && s.jefe_status === "Pendiente") return "jefe";
    if (role.permisos.autorizar_gt5000 && s.monto_total > umbral && s.jefe_status === "Autorizado" && s.finanzas_status === "Pendiente") return "finanzas";
    return false;
  };

  const authorize = (s: Solicitud) => {
    const which = canAuth(s);
    if (!which) return;
    const newAuth: Autorizacion = {
      id: uid("a_"), solicitud_id: s.id,
      rol_autorizador: which === "jefe" ? "jefe_inmediato" : "finanzas",
      user_id: user!.id, status: "autorizado", fecha: new Date().toISOString().slice(0, 10), nota: "",
    };
    setAutorizaciones([...autorizaciones, newAuth]);
    setSolicitudes(solicitudes.map((x) => {
      if (x.id !== s.id) return x;
      const updated: Solicitud = { ...x };
      if (which === "jefe") {
        updated.jefe_status = "Autorizado";
        if (updated.finanzas_status === "N/A") updated.estatus = "Cerrado";
      } else {
        updated.finanzas_status = "Autorizado";
        updated.estatus = "Cerrado";
      }
      return updated;
    }));
    toast.success(`Solicitud ${s.folio} autorizada.`);
    setDetail(null);
  };

  const reject = () => {
    if (!rejecting || !rejectNote.trim()) return showErrorDialog("Captura el motivo.");
    const which = canAuth(rejecting);
    const newAuth: Autorizacion = {
      id: uid("a_"), solicitud_id: rejecting.id,
      rol_autorizador: which === "finanzas" ? "finanzas" : "jefe_inmediato",
      user_id: user!.id, status: "rechazado", fecha: new Date().toISOString().slice(0, 10), nota: rejectNote,
    };
    setAutorizaciones([...autorizaciones, newAuth]);
    setSolicitudes(solicitudes.map((x) => x.id === rejecting.id ? { ...x, estatus: "Rechazado", nota_rechazo: rejectNote, [which === "finanzas" ? "finanzas_status" : "jefe_status"]: "Rechazado" } as Solicitud : x));
    showErrorDialog(`Solicitud ${rejecting.folio} rechazada.`);
    setRejecting(null); setRejectNote(""); setDetail(null);
  };

  const subirComprobante = (s: Solicitud) => {
    const today = new Date().toLocaleDateString("es-MX");
    setSolicitudes(solicitudes.map((x) => x.id === s.id ? { ...x, comprobante_viaje: today } : x));
    toast.success("Comprobante de viaje cargado.");
  };

  const eliminar = (s: Solicitud) => {
    if (autorizaciones.find((a) => a.solicitud_id === s.id)) return showErrorDialog("No se puede eliminar: ya tiene autorizaciones.");
    if (!confirm(`¿Eliminar solicitud ${s.folio}?`)) return;
    setSolicitudes(solicitudes.filter((x) => x.id !== s.id));
    toast.success("Solicitud eliminada.");
  };

  // Herramienta de corrección para administradores: borra las autorizaciones/
  // rechazos ya registrados y regresa la solicitud a Abierto/Pendiente, por si
  // se autorizó o rechazó por error (p. ej. un rol con permisos de más de un
  // nivel resolvió el paso equivocado).
  const revertir = (s: Solicitud) => {
    if (!confirm(`¿Revertir las autorizaciones de la solicitud ${s.folio} y regresarla a Abierto/Pendiente?`)) return;
    setAutorizaciones(autorizaciones.filter((a) => a.solicitud_id !== s.id));
    setSolicitudes(solicitudes.map((x) => (x.id === s.id
      ? {
          ...x,
          estatus: "Abierto",
          jefe_status: "Pendiente",
          finanzas_status: x.finanzas_status === "N/A" ? "N/A" : "Pendiente",
          nota_rechazo: undefined,
        }
      : x)));
    toast.success(`Solicitud ${s.folio} revertida a Abierto/Pendiente.`);
    setDetail(null);
  };

  return (
    <div className="space-y-4">
      <div className="ckl-card flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1">
          <label className="ckl-label">Buscar</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input className="ckl-input pl-8" placeholder="Folio o usuario..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="ckl-label">Estatus</label>
          <select className="ckl-input" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {["Todos", "Abierto", "Cerrado", "Rechazado"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Folio</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Usuario</th>
                <th className="p-3">Destino</th>
                <th className="p-3 text-right">Monto</th>
                <th className="p-3">Jefe</th>
                <th className="p-3">Finanzas</th>
                <th className="p-3">Comprobante</th>
                <th className="p-3"></th>
                <th className="p-3">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const ok = s.jefe_status === "Autorizado" && (s.finanzas_status === "Autorizado" || s.finanzas_status === "N/A");
                const bad = s.estatus === "Rechazado";
                const stripe = bad ? "#E30613" : ok ? "#2D6A4F" : "#CCC";
                return (
                  <tr key={s.id} className="cursor-pointer border-t hover:bg-secondary/50" style={{ borderLeft: `3px solid ${stripe}` }} onDoubleClick={() => setDetail(s)}>
                    <td className="p-3 font-mono text-xs">{s.folio}</td>
                    <td className="p-3 text-xs">{s.fecha}</td>
                    <td className="p-3">{userName(s.user_id)}</td>
                    <td className="p-3 text-xs">{s.destino_resumen}</td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(s.monto_total)}</td>
                    <td className="p-3"><StatusBadge estatus={s.jefe_status} /></td>
                    <td className="p-3"><StatusBadge estatus={s.finanzas_status} /></td>
                    <td className="p-3">
                      {s.comprobante_viaje
                        ? <span className="ckl-badge" style={{ background: "#DCFCE7", color: "#16A34A" }}>Cargado {s.comprobante_viaje}</span>
                        : <span className="ckl-badge" style={{ background: "#FEE2E2", color: "#DC2626" }}>Sin cargar</span>}
                    </td>
                    <td className="p-3">{s.nota_rechazo && <MessageSquareWarning size={16} className="text-[color:var(--color-primary)]" />}</td>
                    <td className="p-3"><StatusBadge estatus={s.estatus} /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-sm text-muted-foreground">Sin solicitudes</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t bg-secondary p-2 text-[11px] text-muted-foreground">Doble clic en una fila para ver detalle.</div>
      </div>

      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <h3 className="text-lg font-semibold">Solicitud {detail.folio}</h3>
          {detail.nota_rechazo && (
            <div className="mt-3 rounded-md p-3 text-sm" style={{ background: "#FEE9EA", color: "#B5040F" }}>
              <b>Rechazo:</b> {detail.nota_rechazo}
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            {[
              ["Fecha", detail.fecha], ["Usuario", userName(detail.user_id)],
              ["Empresa", detail.empresa], ["Origen", detail.origen],
              ["Destino", detail.destino_resumen], ["Tipo", detail.tipo_viaje],
              ["Personas", String(detail.personas_count)], ["Viajeros", detail.personas_nombres],
              ["Monto total", fmtMoney(detail.monto_total)], ["Estatus", detail.estatus],
            ].map(([k, v]) => (
              <div key={k}><div className="text-muted-foreground">{k}</div><div className="font-medium">{v}</div></div>
            ))}
          </dl>
          <p className="mt-3 text-xs"><b>Motivo:</b> {detail.motivo}</p>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {canEdit(detail) && (
              <>
                <button
                  onClick={() => {
                    const id = detail.id;
                    setDetail(null);
                    nav({ to: "/solicitar", search: { editId: id } });
                  }}
                  className="ckl-btn-outline"
                >
                  <Edit2 size={14} /> Editar
                </button>
                <button onClick={() => eliminar(detail)} className="ckl-btn-outline">Eliminar</button>
              </>
            )}
            {role?.permisos.subir_comprobantes_viaje && !detail.comprobante_viaje && detail.estatus === "Cerrado" && (
              <button onClick={() => subirComprobante(detail)} className="ckl-btn-outline"><Upload size={14} /> Subir comprobantes</button>
            )}
            {canAuth(detail) && (
              <>
                <button onClick={() => setRejecting(detail)} className="ckl-btn-outline"><X size={14} /> Rechazar</button>
                <button onClick={() => authorize(detail)} className="ckl-btn-primary"><Check size={14} /> Autorizar</button>
              </>
            )}
            {hasPerm("configurar_permisos") && autorizaciones.some((a) => a.solicitud_id === detail.id) && (
              <button onClick={() => revertir(detail)} className="ckl-btn-outline">
                <RotateCcw size={14} /> Revertir autorización
              </button>
            )}
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal onClose={() => setRejecting(null)}>
          <h3 className="text-lg font-semibold">Motivo de rechazo</h3>
          <textarea className="ckl-input mt-3 min-h-[100px]" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Describe por qué se rechaza esta solicitud..." />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setRejecting(null)} className="ckl-btn-ghost">Cancelar</button>
            <button onClick={reject} className="ckl-btn-primary">Confirmar rechazo</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
