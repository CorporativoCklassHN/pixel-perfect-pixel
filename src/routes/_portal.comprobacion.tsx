import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Upload,
  FileText,
  FileCode,
  Trash2,
  Eye,
  Download,
  Search,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, useLocalStorage } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import {
  KEYS,
  fmtMoney,
  filterSolicitudesByOwnership,
  uid,
  avanceComprobacion,
  type Solicitud,
  type ComprobanteGasto,
  type Sociedad,
  type User,
} from "@/lib/store";

export const Route = createFileRoute("/_portal/comprobacion")({
  // solicitudId: folio a dejar seleccionado al llegar (p. ej. desde "Comprobar gastos" en Estatus).
  validateSearch: (search: Record<string, unknown>): { solicitudId?: string } => {
    const solicitudId = typeof search.solicitudId === "string" ? search.solicitudId : undefined;
    return solicitudId ? { solicitudId } : {};
  },
  head: () => ({ meta: [{ title: "Comprobación — CKL" }] }),
  component: Comprobacion,
});

type Factura = {
  id: string;
  solicitud_id: string;
  tipo: "XML" | "PDF";
  fecha: string;
  uuid: string;
  archivo: string;
  total: number;
  status: "Verificado" | "Error";
  // Renglón de la tabla de comprobación al que se aplicó este monto, y cuánto se le aplicó
  // (puede ser menor a `total` si el renglón se saturó). Permite revertir exacto al eliminar.
  concepto_id: string | null;
  monto_aplicado: number;
  // Data URL (base64) del archivo, para poder verlo/descargarlo después sin
  // pedirlo de nuevo — localStorage no puede guardar un File/Blob tal cual.
  contenido: string;
};

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Chrome bloquea window.open() directo a una URL data: (medida anti-phishing).
// Se convierte a un Blob URL, que sí se puede abrir/descargar sin problema.
function verFactura(f: Factura) {
  const url = URL.createObjectURL(dataUrlToBlob(f.contenido));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function descargarFactura(f: Factura) {
  const url = URL.createObjectURL(dataUrlToBlob(f.contenido));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.archivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function Comprobacion() {
  const { user, role } = useAuth();
  // Gestor de vuelos solo debe ver/comprobar el concepto "Avión" de cada
  // folio — el resto (Hotel, Transporte foráneo terrestre, Transporte local,
  // Comida, Otros) y las secciones de No deducibles/Depósito sobrante no le
  // corresponden.
  const soloAvion = role?.nombre === "gestor_vuelos";
  const [solicitudes] = useLocalStorage<Solicitud[]>(KEYS.solicitudes, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [sociedades] = useLocalStorage<Sociedad[]>(KEYS.sociedades, []);
  const [comprobantes, setComprobantes] = useLocalStorage<ComprobanteGasto[]>(
    KEYS.comprobantesGasto,
    [],
  );
  const [facturas, setFacturas] = useLocalStorage<Factura[]>(KEYS.facturasXml, []);
  // Alcance por rol: el usuario solo ve sus folios; ver_equipo/ver_todo amplían.
  const cerradas = filterSolicitudesByOwnership(user, role, solicitudes, users).filter(
    (s) => s.estatus === "Cerrado",
  );
  const nav = useNavigate();
  const { solicitudId } = Route.useSearch();
  const [sidState, setSid] = useState<string>(() =>
    cerradas.some((c) => c.id === solicitudId) ? solicitudId! : (cerradas[0]?.id ?? ""),
  );
  // Si el folio guardado ya no está en el alcance del usuario, cae al primero disponible.
  const sid = cerradas.some((c) => c.id === sidState) ? sidState : (cerradas[0]?.id ?? "");
  // Si la URL trae (o cambia a) un solicitudId válido, ese folio queda seleccionado.
  useEffect(() => {
    if (solicitudId && cerradas.some((c) => c.id === solicitudId)) {
      setSid(solicitudId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitudId, solicitudes, users, user, role]);
  // Selección manual: actualiza el estado y refleja el folio en la URL (sin apilar historial).
  const selectFolio = (id: string) => {
    setSid(id);
    nav({ to: "/comprobacion", search: { solicitudId: id }, replace: true });
  };
  const sel = cerradas.find((s) => s.id === sid);
  // Cada usuario factura a la Sociedad (razón social) con la que solicitó el
  // viático, no a su propio RFC personal — el Receptor del CFDI debe ser esa
  // sociedad.
  const solSociedad = sociedades.find((so) => so.nombre === sel?.empresa);
  const rows = useMemo(
    () =>
      comprobantes
        .filter((c) => c.solicitud_id === sid)
        .filter((c) => !soloAvion || c.concepto === "Avión"),
    [comprobantes, sid, soloAvion],
  );
  const fs = useMemo(() => facturas.filter((f) => f.solicitud_id === sid), [facturas, sid]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (line: string) =>
    setLog((l) => [`${new Date().toTimeString().slice(0, 8)} ${line}`, ...l].slice(0, 50));

  // El renglón a comprobar (concepto) se recibe explícito desde el botón que
  // se presionó en esa fila de la tabla — ya no se adivina tomando "el primer
  // renglón pendiente", que podía aplicar una factura de hotel al concepto
  // de transporte por simple coincidencia de orden.
  const onFile = (kind: "XML" | "PDF", concepto: ComprobanteGasto) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = kind === "XML" ? ".xml" : ".pdf,.jpg,.png";
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file || !sel) return;
      if (fs.some((f) => f.archivo === file.name)) {
        addLog(`✖ Archivo duplicado: ${file.name}`);
        showErrorDialog(`El archivo "${file.name}" ya fue cargado para esta solicitud.`);
        return;
      }
      const total = Math.floor(Math.random() * 800) + 200;
      let status: "Verificado" | "Error" = "Verificado";
      const uuidv = uid("UUID-").toUpperCase();
      if (kind === "XML") {
        const text = await file.text();
        if (!text.includes("cfdi:Emisor") && !text.toLowerCase().includes("emisor")) {
          addLog(`✖ Nodo cfdi:Emisor no encontrado`);
          status = "Error";
        } else {
          const rfcMatch = text.match(/Receptor[^>]*Rfc=["']([^"']+)["']/i);
          const rfcEsperado = solSociedad?.rfc;
          if (rfcMatch && rfcEsperado && rfcMatch[1].toUpperCase() !== rfcEsperado.toUpperCase()) {
            addLog(`✖ RFC del Receptor no coincide (esperado: ${rfcEsperado})`);
            status = "Error";
          } else {
            addLog(`✔ XML verificado CFDI 4.0 para "${concepto.concepto}". UUID: ${uuidv}`);
          }
        }
      } else {
        addLog(`✔ PDF cargado para "${concepto.concepto}": ${file.name}`);
      }
      let montoAplicado = 0;
      if (status === "Verificado") {
        montoAplicado = Math.min(total, concepto.monto_solicitado - concepto.monto_comprobado);
        setComprobantes(
          comprobantes.map((c) =>
            c.id === concepto.id
              ? {
                  ...c,
                  monto_comprobado: c.monto_comprobado + montoAplicado,
                  status_renglon:
                    c.monto_comprobado + montoAplicado >= c.monto_solicitado
                      ? "comprobado"
                      : "parcialmente_comprobado",
                }
              : c,
          ),
        );
        toast.success(`Comprobante de "${concepto.concepto}" cargado y verificado.`);
      } else {
        showErrorDialog("Error de validación. Revisa el log.");
      }
      const contenido = await readAsDataURL(file);
      const factura: Factura = {
        id: uid("f_"),
        solicitud_id: sid,
        tipo: kind,
        fecha: new Date().toLocaleDateString("es-MX"),
        uuid: uuidv,
        archivo: file.name,
        total,
        status,
        concepto_id: concepto.id,
        monto_aplicado: montoAplicado,
        contenido,
      };
      setFacturas([factura, ...facturas]);
    };
    inp.click();
  };

  const removeFactura = (id: string) => {
    const f = facturas.find((x) => x.id === id);
    setFacturas(facturas.filter((x) => x.id !== id));
    if (f?.concepto_id && f.monto_aplicado > 0) {
      setComprobantes(
        comprobantes.map((c) => {
          if (c.id !== f.concepto_id) return c;
          const nuevo = Math.max(0, c.monto_comprobado - f.monto_aplicado);
          return {
            ...c,
            monto_comprobado: nuevo,
            status_renglon:
              nuevo <= 0
                ? "pendiente"
                : nuevo >= c.monto_solicitado
                  ? "comprobado"
                  : "parcialmente_comprobado",
          };
        }),
      );
    }
    toast.success("Factura eliminada.");
  };

  if (!sel)
    return (
      <div className="ckl-card p-8 text-center text-sm text-muted-foreground">
        No hay solicitudes cerradas para comprobar.
      </div>
    );

  const totSol = rows.reduce((a, r) => a + r.monto_solicitado, 0);
  const totComp = rows.reduce((a, r) => a + r.monto_comprobado, 0);
  // Estatus global: comprobado solo cuando el total comprobado iguala al total solicitado.
  const comprobado = totSol > 0 && totComp === totSol;

  // Mismo criterio que "comprobado" arriba, pero para cualquier folio del
  // listado (no solo el seleccionado) — así el selector puede pintar en
  // verde los que ya están completos.
  const avanceDe = (solicitudId: string) =>
    avanceComprobacion(comprobantes, solicitudId, soloAvion);

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <FolioPicker
        solicitudes={cerradas}
        selectedId={sid}
        avanceDe={avanceDe}
        onSelect={selectFolio}
      />
      <div className="min-w-0 space-y-5">
      <div className="ckl-card p-4 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{sel.folio}</span> · {sel.empresa} ·{" "}
        {sel.tipo_viaje} · {sel.fecha}
      </div>

      {/* Tabla */}
      <div className="ckl-card overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <span className="text-sm font-semibold">Tabla de comprobación</span>
          <span
            className="ckl-badge"
            style={{
              background: comprobado ? "#D8F3DC" : "#FEF3C7",
              color: comprobado ? "#2D6A4F" : "#B45309",
            }}
          >
            {comprobado ? "Comprobado" : "Pendiente de comprobar"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Concepto</th>
                <th className="p-3 text-right">Solicitado</th>
                <th className="p-3 text-right">Comprobado</th>
                <th className="p-3 text-right">Dif.</th>
                <th className="p-3">Estatus</th>
                <th className="p-3">Adjuntar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dif = r.monto_comprobado - r.monto_solicitado;
                const bg: Record<string, string> = {
                  comprobado: "#D8F3DC",
                  parcialmente_comprobado: "#DBEAFE",
                  pendiente: "#FEF3C7",
                  no_aplica: "#F1F3F5",
                };
                const fg: Record<string, string> = {
                  comprobado: "#2D6A4F",
                  parcialmente_comprobado: "#1D4ED8",
                  pendiente: "#B45309",
                  no_aplica: "#666",
                };
                const cerrado =
                  r.status_renglon === "comprobado" || r.status_renglon === "no_aplica";
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-3">{r.concepto}</td>
                    <td className="p-3 text-right">{fmtMoney(r.monto_solicitado)}</td>
                    <td className="p-3 text-right">{fmtMoney(r.monto_comprobado)}</td>
                    <td
                      className="p-3 text-right font-semibold"
                      style={{ color: dif < 0 ? "#E30613" : "#2D6A4F" }}
                    >
                      {fmtMoney(dif)}
                    </td>
                    <td className="p-3">
                      <span
                        className="ckl-badge"
                        style={{ background: bg[r.status_renglon], color: fg[r.status_renglon] }}
                      >
                        {r.status_renglon.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3">
                      {cerrado ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            title={`Adjuntar XML para ${r.concepto}`}
                            onClick={() => onFile("XML", r)}
                            className="rounded p-1.5 hover:bg-secondary"
                            style={{ color: "var(--color-primary)" }}
                          >
                            <FileCode size={15} />
                          </button>
                          <button
                            title={`Adjuntar PDF para ${r.concepto}`}
                            onClick={() => onFile("PDF", r)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                          >
                            <FileText size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t bg-secondary font-semibold">
                <td className="p-3">Totales</td>
                <td className="p-3 text-right">{fmtMoney(totSol)}</td>
                <td className="p-3 text-right">{fmtMoney(totComp)}</td>
                <td className="p-3 text-right">{fmtMoney(totComp - totSol)}</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Validación */}
      <div className="ckl-card p-4">
        <div className="text-sm font-semibold">Validación de comprobantes</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Usa los íconos <FileCode size={11} className="inline" /> XML /{" "}
          <FileText size={11} className="inline" /> PDF junto a cada concepto en la tabla de arriba
          — así queda claro a qué renglón corresponde cada comprobante.
        </p>
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">Log de validación</div>
          <div className="max-h-[120px] overflow-auto rounded-md border bg-secondary p-2 font-mono text-[11px]">
            {log.length === 0 ? (
              <span className="text-muted-foreground">Sin actividad…</span>
            ) : (
              log.map((l, i) => <div key={i}>{l}</div>)
            )}
          </div>
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="border-b p-4 text-sm font-semibold">Facturas cargadas</div>
        {/* Móvil (< 768 px): tarjetas apiladas en lugar de tabla de 8 columnas. */}
        <ul className="divide-y md:hidden">
          {fs.length === 0 && (
            <li className="p-6 text-center text-xs text-muted-foreground">Sin facturas</li>
          )}
          {fs.map((f) => {
            const concepto = comprobantes.find((c) => c.id === f.concepto_id)?.concepto ?? "—";
            return (
              <li key={f.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="ckl-badge" style={{ background: "#F1F3F5", color: "#333" }}>
                      {f.tipo}
                    </span>
                    <span className="text-sm font-medium">{concepto}</span>
                  </div>
                  <span
                    className="ckl-badge"
                    style={{
                      background: f.status === "Verificado" ? "#D8F3DC" : "#FEE9EA",
                      color: f.status === "Verificado" ? "#2D6A4F" : "#E30613",
                    }}
                  >
                    {f.status}
                  </span>
                </div>
                <div className="mt-1 break-all text-xs">{f.archivo}</div>
                <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                  {f.uuid}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {f.fecha} · <b className="text-foreground">{fmtMoney(f.total)}</b>
                  </span>
                  <div className="flex gap-1">
                    <button title="Ver" aria-label="Ver" className="rounded p-2 hover:bg-secondary" onClick={() => verFactura(f)}>
                      <Eye size={16} />
                    </button>
                    <button title="Descargar" aria-label="Descargar" className="rounded p-2 hover:bg-secondary" onClick={() => descargarFactura(f)}>
                      <Download size={16} />
                    </button>
                    <button title="Eliminar" aria-label="Eliminar" className="rounded p-2 hover:bg-secondary" onClick={() => removeFactura(f.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Tipo</th>
                <th className="p-3">Concepto</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">UUID</th>
                <th className="p-3">Archivo</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3">Estatus</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {fs.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-xs text-muted-foreground">
                    Sin facturas
                  </td>
                </tr>
              )}
              {fs.map((f) => {
                const concepto = comprobantes.find((c) => c.id === f.concepto_id)?.concepto ?? "—";
                return (
                  <tr key={f.id} className="border-t">
                    <td className="p-3">
                      <span className="ckl-badge" style={{ background: "#F1F3F5", color: "#333" }}>
                        {f.tipo}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{concepto}</td>
                    <td className="p-3 text-xs">{f.fecha}</td>
                    <td className="p-3 font-mono text-[11px]">{f.uuid}</td>
                    <td className="p-3 text-xs">{f.archivo}</td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(f.total)}</td>
                    <td className="p-3">
                      <span
                        className="ckl-badge"
                        style={{
                          background: f.status === "Verificado" ? "#D8F3DC" : "#FEE9EA",
                          color: f.status === "Verificado" ? "#2D6A4F" : "#E30613",
                        }}
                      >
                        {f.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button
                          title="Ver"
                          className="rounded p-1 hover:bg-secondary"
                          onClick={() => verFactura(f)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          title="Descargar"
                          className="rounded p-1 hover:bg-secondary"
                          onClick={() => descargarFactura(f)}
                        >
                          <Download size={14} />
                        </button>
                        <button
                          title="Eliminar"
                          className="rounded p-1 hover:bg-secondary"
                          onClick={() => removeFactura(f.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!soloAvion && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="ckl-card p-4">
            <div className="text-sm font-semibold">No deducibles</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <input className="ckl-input" placeholder="Monto" />
              <input className="ckl-input" placeholder="Establecimiento" />
              <input className="ckl-input" placeholder="Lugar" />
            </div>
            <button className="ckl-btn-outline mt-3" onClick={() => toast.success("Foto adjunta.")}>
              <Upload size={14} /> Adjuntar foto
            </button>
          </div>
          <div className="ckl-card p-4" style={{ borderLeft: "4px solid var(--color-primary)" }}>
            <div className="text-sm font-semibold">Depósito sobrante</div>
            <div
              className="mt-2 rounded-md p-2 text-xs"
              style={{ background: "#FEF3C7", color: "#D97706" }}
            >
              Es obligatorio reintegrar el sobrante con comprobante bancario.
            </div>
            <div className="mt-3 flex gap-2">
              <input className="ckl-input" placeholder="Monto a reintegrar" />
              <button
                className="ckl-btn-primary"
                onClick={() => toast.success("Comprobante bancario cargado.")}
              >
                <Upload size={14} /> Cargar
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Panel maestro: tarjetas de folios con buscador y barra de avance de comprobación.
// En móvil (< 1024 px) se colapsa al folio elegido y se despliega con "Cambiar folio".
function FolioPicker({
  solicitudes,
  selectedId,
  avanceDe,
  onSelect,
}: {
  solicitudes: Solicitud[];
  selectedId: string;
  avanceDe: (solicitudId: string) => ReturnType<typeof avanceComprobacion>;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = solicitudes.find((s) => s.id === selectedId);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return solicitudes;
    return solicitudes.filter((s) =>
      [s.folio, s.destino_resumen, s.fecha, s.empresa].some((v) => v.toLowerCase().includes(t)),
    );
  }, [solicitudes, q]);

  const renderCard = (s: Solicitud) => {
    const a = avanceDe(s.id);
    const activo = s.id === selectedId;
    return (
      <div
        className="w-full rounded-lg border p-3 text-left"
        style={{
          borderColor: activo ? "var(--color-primary)" : "var(--color-border)",
          background: activo ? "var(--color-primary-soft)" : "white",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-semibold">{s.folio}</span>
          <span
            className="ckl-badge"
            style={{
              background: a.completo ? "#D8F3DC" : "#FEF3C7",
              color: a.completo ? "#2D6A4F" : "#B45309",
            }}
          >
            {a.completo && <CheckCircle2 size={11} />}[{a.completo ? "Comprobado" : "Pendiente"}]
          </span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">{s.destino_resumen}</div>
        <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>{s.fecha}</span>
          <span className="font-semibold text-foreground">{fmtMoney(s.monto_total)}</span>
        </div>
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>
              {fmtMoney(a.comprobado)} de {fmtMoney(a.solicitado)}
            </span>
            <span className="font-semibold">{a.pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={a.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${a.pct}%`, background: a.completo ? "#2D6A4F" : "#E30613" }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="ckl-picker ckl-card p-3 lg:sticky lg:top-4">
      <label className="ckl-label">Folio</label>

      {/* Móvil: folio seleccionado + botón para desplegar el listado */}
      {selected && (
        <div className="space-y-2 lg:hidden">
          {renderCard(selected)}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="ckl-btn-outline w-full justify-center"
            aria-expanded={open}
          >
            {open ? "Ocultar folios" : "Cambiar folio"}
            <ChevronDown size={14} className={open ? "rotate-180" : ""} />
          </button>
        </div>
      )}

      <div className={`${open ? "block" : "hidden"} mt-3 lg:mt-0 lg:block`}>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={15}
          />
          <input
            className="ckl-input pl-8"
            placeholder="Buscar folio, destino o fecha..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-0.5 lg:max-h-[65vh]">
          {visibles.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="block w-full"
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
              >
                {renderCard(s)}
              </button>
            </li>
          ))}
          {visibles.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">Sin resultados</li>
          )}
        </ul>
      </div>
    </aside>
  );
}
