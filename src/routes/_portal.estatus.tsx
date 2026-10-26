import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Search,
  MessageSquareWarning,
  Upload,
  Check,
  X,
  Edit2,
  RotateCcw,
  Eye,
  ReceiptText,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useLocalStorage } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import {
  KEYS,
  fmtMoney,
  uid,
  filterSolicitudesByDateCutoff,
  filterSolicitudesByOwnership,
  avanceComprobacion,
  avanceValidacion,
  estatusVisible,
  ESTATUS_VISIBLES,
  type Solicitud,
  type User,
  type Autorizacion,
  type Hotel,
  type ComprobanteGasto,
} from "@/lib/store";
import { StatusBadge } from "./_portal.dashboard";
import { Modal } from "./_portal.solicitar";

export const Route = createFileRoute("/_portal/estatus")({
  validateSearch: (search: Record<string, unknown>): { atrasados?: boolean } =>
    search.atrasados ? { atrasados: true } : {},
  head: () => ({ meta: [{ title: "Estatus de viáticos — CKL" }] }),
  component: Estatus,
});

// Refleja la forma que guarda "Solicitar viáticos" en KEYS.destinos — no se
// exporta desde ahí porque es un detalle de esa pantalla, pero Estatus la lee
// para mostrarle a quien autoriza el desglose completo (hoteles, transportes,
// otros conceptos) detrás del monto total.
type HotelStayStored = {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
  monto: number;
  manual: boolean;
  hotel_id?: number;
};
type RowStored = { id: string; tipo: string; monto: number };
type OtroRowStored = { id: string; concepto: string; monto: number };
type DestinoStored = {
  id: string;
  solicitud_id: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  hoteles: HotelStayStored[];
  foraneo: RowStored[];
  local: RowStored[];
  otros: OtroRowStored[];
};

function daysBetween(a: string, b: string) {
  if (!a || !b) return 0;
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.max(0, Math.floor((d2.getTime() - d1.getTime()) / 86400000) + 1);
}

// Noches de hotel = días del rango - 1 (entrada y salida el mismo día no genera noche).
function nightsBetween(a: string, b: string) {
  return Math.max(0, daysBetween(a, b) - 1);
}

// Preferimos hotel_id (el hotel elegido, exista o no un monto manual encima).
// Solicitudes guardadas antes de que existiera ese campo solo tienen la
// tarifa: se busca en el catálogo un hotel del mismo estado con esa tarifa
// como respaldo, y si tampoco hay match se muestra una etiqueta genérica.
function resolveHotelName(h: HotelStayStored, estado: string, catalogo: Hotel[]) {
  const porId = h.hotel_id ? catalogo.find((ho) => ho.id === h.hotel_id) : undefined;
  if (porId) return porId.nombre;
  if (h.manual) return "Monto manual";
  const match = catalogo.find((ho) => ho.estado === estado && ho.tarifa_base === h.monto);
  return match?.nombre ?? "Hotel";
}

function Estatus() {
  const { user, role, hasPerm } = useAuth();
  const nav = useNavigate();
  const { atrasados: soloAtrasados } = Route.useSearch();
  const [solicitudes, setSolicitudes] = useLocalStorage<Solicitud[]>(KEYS.solicitudes, []);
  const [autorizaciones, setAutorizaciones] = useLocalStorage<Autorizacion[]>(KEYS.autorizaciones, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [destinosAll] = useLocalStorage<DestinoStored[]>(KEYS.destinos, []);
  const [comprobantesGasto] = useLocalStorage<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
  const [hotelesCatalogo] = useLocalStorage<Hotel[]>(KEYS.hoteles, []);
  const config = JSON.parse(typeof window !== "undefined" ? localStorage.getItem(KEYS.config) ?? "{}" : "{}");
  const umbral = config.umbral_finanzas ?? 5000;
  const diasComprobacionAtrasada = config.dias_comprobacion_atrasada ?? 7;

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("Todos");
  const [usuarioFiltro, setUsuarioFiltro] = useState("Todos");
  const [detail, setDetail] = useState<Solicitud | null>(null);
  const [rejecting, setRejecting] = useState<Solicitud | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  // Mismo criterio que usa "Comprobación": comprobado solo cuando el total
  // comprobado iguala al total solicitado en todos sus renglones.
  const estaComprobado = (solicitudId: string) =>
    avanceComprobacion(comprobantesGasto, solicitudId).completo;
  // Etiqueta que ve el usuario (Pendiente/Autorizado/Comprobado/Rechazado); el
  // valor guardado en s.estatus sigue siendo Abierto/Cerrado/Rechazado.
  const etiquetaEstatus = (s: Solicitud) => estatusVisible(s.estatus, estaComprobado(s.id));
  // Marca de "Validado por Compras" (todos los conceptos validados) junto al estatus.
  const estaValidado = (solicitudId: string) =>
    avanceValidacion(comprobantesGasto, solicitudId).completa;
  const marcaValidado = (s: Solicitud) =>
    s.estatus === "Cerrado" && estaValidado(s.id) ? (
      <span
        className="ml-1 inline-flex align-middle"
        style={{ color: "#2D6A4F" }}
        title="Validado por Compras Corporativas"
      >
        <CheckCircle2 size={15} />
      </span>
    ) : null;
  // Compras Corporativas entra directo a validar los folios ya comprobados por completo;
  // el resto de los casos abre el detalle de siempre.
  const esValidador = hasPerm("validar_comprobacion") && !hasPerm("comprobar");
  const abrirFolio = (s: Solicitud) => {
    if (esValidador && s.estatus === "Cerrado" && estaComprobado(s.id)) {
      nav({ to: "/comprobacion", search: { solicitudId: s.id } });
      return;
    }
    setDetail(s);
  };

  // Alcance por rol: el usuario solo ve sus folios, el jefe inmediato solo los de
  // quienes lo tienen como jefe, y los roles con "ver todo" ven todos. Además se
  // aplica la ventana de fechas del rol. Más recientes primero (empate: folio mayor).
  const visibles = useMemo(
    () =>
      filterSolicitudesByDateCutoff(
        filterSolicitudesByOwnership(user, role, solicitudes, users),
        role?.nombre,
      ).sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) ||
          b.folio.localeCompare(a.folio, undefined, { numeric: true }),
      ),
    [user, role, solicitudes, users],
  );
  // Opciones del filtro por Usuario: solo quienes tienen folios dentro del alcance.
  const usuariosOpciones = useMemo(() => {
    const ids = new Set(visibles.map((s) => s.user_id));
    return users.filter((u) => ids.has(u.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [visibles, users]);

  const filtered = useMemo(() => {
    const comprobado = (id: string) => avanceComprobacion(comprobantesGasto, id).completo;
    return visibles.filter((s) => {
      const u = users.find((x) => x.id === s.user_id);
      const matchQ = !q || s.folio.toLowerCase().includes(q.toLowerCase()) || (u?.nombre.toLowerCase().includes(q.toLowerCase()) ?? false);
      const matchE =
        estado === "Todos" || estatusVisible(s.estatus, comprobado(s.id)) === estado;
      const diasTranscurridos = (Date.now() - new Date(s.created_at).getTime()) / 86400000;
      const matchU = usuarioFiltro === "Todos" || s.user_id === usuarioFiltro;
      const matchAtrasados =
        !soloAtrasados ||
        (s.estatus === "Cerrado" &&
          !comprobado(s.id) &&
          diasTranscurridos > diasComprobacionAtrasada);
      return matchQ && matchE && matchU && matchAtrasados;
    });
  }, [
    visibles,
    q,
    estado,
    usuarioFiltro,
    users,
    soloAtrasados,
    comprobantesGasto,
    diasComprobacionAtrasada,
  ]);

  // Desglose detallado (hoteles, transportes, otros conceptos) del folio abierto
  // en el modal, para que quien autoriza vea qué compone el monto total.
  const destinosDetail = useMemo(
    () => (detail ? destinosAll.filter((d) => d.solicitud_id === detail.id) : []),
    [detail, destinosAll],
  );
  const resumenMontos = useMemo(
    () => (detail ? comprobantesGasto.filter((c) => c.solicitud_id === detail.id) : []),
    [detail, comprobantesGasto],
  );

  const userName = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";

  const canEdit = (s: Solicitud) => s.user_id === user?.id && s.estatus === "Abierto" && !autorizaciones.find((a) => a.solicitud_id === s.id);

  const canAuth = (s: Solicitud) => {
    if (!role) return false;
    if (s.estatus !== "Abierto") return false;
    // Nadie autoriza ni rechaza su propia solicitud (p. ej. un jefe que ve sus folios).
    if (s.user_id === user?.id) return false;
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
      {soloAtrasados && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md p-3 text-sm"
          style={{ background: "#FEE9EA", color: "#B5040F" }}
        >
          <span>
            Mostrando solo folios cerrados con más de {diasComprobacionAtrasada} días sin comprobar
            por completo.
          </span>
          <button
            onClick={() => nav({ to: "/estatus" })}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold hover:bg-black/5"
          >
            Quitar filtro
          </button>
        </div>
      )}
      <div className="ckl-card flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1">
          <label className="ckl-label">Buscar</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input className="ckl-input pl-8" placeholder="Folio o usuario..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {usuariosOpciones.length > 1 && (
          <div>
            <label className="ckl-label">Usuario</label>
            <select
              className="ckl-input"
              value={usuarioFiltro}
              onChange={(e) => setUsuarioFiltro(e.target.value)}
            >
              <option value="Todos">Todos</option>
              {usuariosOpciones.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="ckl-label">Estatus</label>
          <select className="ckl-input" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {["Todos", ...ESTATUS_VISIBLES].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        {/* Móvil (< 768 px): tarjetas apiladas. Un toque (o el ojo) abre el detalle;
            así no depende del doble toque, que en móvil dispara el zoom del navegador. */}
        <ul className="divide-y md:hidden">
          {filtered.map((s) => {
            const ok = s.jefe_status === "Autorizado" && (s.finanzas_status === "Autorizado" || s.finanzas_status === "N/A");
            const bad = s.estatus === "Rechazado";
            const stripe = bad ? "#E30613" : ok ? "#2D6A4F" : "#CCC";
            return (
              <li key={s.id} style={{ borderLeft: `3px solid ${stripe}`, touchAction: "manipulation" }}>
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => abrirFolio(s)}
                    className="min-w-0 flex-1 p-3 text-left active:bg-secondary/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{s.folio}</span>
                      <span className="inline-flex items-center">
                        <StatusBadge estatus={s.estatus} comprobado={estaComprobado(s.id)} />
                        {marcaValidado(s)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{userName(s.user_id)}</span>
                      <span className="shrink-0 text-sm font-semibold">{fmtMoney(s.monto_total)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {s.destino_resumen} · {s.fecha}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">Jefe</span>
                      <StatusBadge estatus={s.jefe_status} />
                      <span className="ml-1 text-muted-foreground">Finanzas</span>
                      <StatusBadge estatus={s.finanzas_status} />
                      {s.nota_rechazo && (
                        <MessageSquareWarning size={14} className="text-[color:var(--color-primary)]" />
                      )}
                    </div>
                    <div className="mt-1.5">
                      {s.comprobante_viaje ? (
                        <span className="ckl-badge" style={{ background: "#DCFCE7", color: "#16A34A" }}>Comprobante cargado {s.comprobante_viaje}</span>
                      ) : (
                        <span className="ckl-badge" style={{ background: "#FEE2E2", color: "#DC2626" }}>Comprobante sin cargar</span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => abrirFolio(s)}
                    aria-label={`Ver detalle del folio ${s.folio}`}
                    className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 border-l text-[10px] font-semibold active:bg-secondary/60"
                    style={{ color: "var(--color-primary)" }}
                  >
                    <Eye size={20} />
                    Ver
                  </button>
                </div>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="p-8 text-center text-sm text-muted-foreground">Sin solicitudes</li>
          )}
        </ul>

        <div className="hidden overflow-x-auto md:block">
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
                  <tr key={s.id} className="cursor-pointer border-t hover:bg-secondary/50" style={{ borderLeft: `3px solid ${stripe}` }} onDoubleClick={() => abrirFolio(s)}>
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
                    <td className="p-3 whitespace-nowrap"><StatusBadge estatus={s.estatus} comprobado={estaComprobado(s.id)} />{marcaValidado(s)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-sm text-muted-foreground">Sin solicitudes</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t bg-secondary p-2 text-[11px] text-muted-foreground">
          <span className="hidden md:inline">
            {esValidador
              ? "Doble clic en un folio Comprobado para validar sus facturas; en el resto, para ver el detalle."
              : "Doble clic en una fila para ver detalle."}
          </span>
          <span className="md:hidden">
            {esValidador
              ? "Toca un folio Comprobado (o el ojo) para validarlo; en el resto, para ver el detalle."
              : "Toca un folio (o el ojo) para ver el detalle."}
          </span>
        </div>
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
              ["Monto total", fmtMoney(detail.monto_total)], ["Estatus", etiquetaEstatus(detail)],
            ].map(([k, v]) => (
              <div key={k}><div className="text-muted-foreground">{k}</div><div className="font-medium">{v}</div></div>
            ))}
          </dl>
          <p className="mt-3 text-xs"><b>Motivo:</b> {detail.motivo}</p>

          {resumenMontos.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <div className="text-xs font-semibold">Resumen de montos</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {resumenMontos.map((c) => (
                  <div key={c.id}>
                    <div className="text-muted-foreground">{c.concepto}</div>
                    <div className="font-medium">{fmtMoney(c.monto_solicitado)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {destinosDetail.length > 0 && (
            <div className="mt-4 space-y-3 border-t pt-3">
              <div className="text-xs font-semibold">Desglose por destino</div>
              {destinosDetail.map((d, idx) => (
                <div key={d.id} className="rounded-md border bg-secondary/50 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="ckl-badge"
                      style={{ background: "var(--color-primary)", color: "white" }}
                    >
                      Destino {idx + 1}
                    </span>
                    <span className="font-medium">{d.estado}</span>
                    <span className="text-muted-foreground">
                      {d.fecha_inicio} → {d.fecha_fin}
                    </span>
                  </div>

                  {d.hoteles?.length > 0 && (
                    <div className="mt-2">
                      <div className="font-semibold text-muted-foreground">Hoteles</div>
                      {d.hoteles.map((h) => {
                        const noches = nightsBetween(h.fecha_inicio, h.fecha_fin);
                        const subtotal = h.manual ? h.monto : noches * h.monto;
                        return (
                          <div key={h.id} className="mt-1 flex items-center justify-between gap-2">
                            <span>
                              {resolveHotelName(h, d.estado, hotelesCatalogo)} · {h.fecha_inicio} →{" "}
                              {h.fecha_fin} {h.manual ? "" : `· ${noches} noche(s)`}
                            </span>
                            <span className="shrink-0 font-medium">{fmtMoney(subtotal)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {d.foraneo?.length > 0 && (
                    <div className="mt-2">
                      <div className="font-semibold text-muted-foreground">Transporte foráneo</div>
                      {d.foraneo.map((r) => (
                        <div key={r.id} className="mt-1 flex items-center justify-between gap-2">
                          <span>{r.tipo}</span>
                          <span className="font-medium">{fmtMoney(r.monto)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {d.local?.length > 0 && (
                    <div className="mt-2">
                      <div className="font-semibold text-muted-foreground">Transporte local</div>
                      {d.local.map((r) => (
                        <div key={r.id} className="mt-1 flex items-center justify-between gap-2">
                          <span>{r.tipo}</span>
                          <span className="font-medium">{fmtMoney(r.monto)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {d.otros?.length > 0 && (
                    <div className="mt-2">
                      <div className="font-semibold text-muted-foreground">Otros conceptos</div>
                      {d.otros.map((r) => (
                        <div key={r.id} className="mt-1 flex items-center justify-between gap-2">
                          <span>{r.concepto || "—"}</span>
                          <span className="font-medium">{fmtMoney(r.monto)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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
            {detail.estatus === "Cerrado" && role?.permisos.comprobar && role.nombre !== "administrador" && (
              <button
                onClick={() => {
                  const id = detail.id;
                  setDetail(null);
                  nav({ to: "/comprobacion", search: { solicitudId: id } });
                }}
                className="ckl-btn-outline"
              >
                <ReceiptText size={14} /> Comprobar gastos
              </button>
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
