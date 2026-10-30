import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Upload,
  Paperclip,
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
  avanceValidacion,
  agruparFacturas,
  conceptoRequierePar,
  type Factura,
  type Solicitud,
  type ComprobanteGasto,
  type Sociedad,
  type User,
} from "@/lib/store";
import {
  SubirComprobanteDialog,
  type ArchivosComprobante,
} from "@/components/portal/SubirComprobanteDialog";

export const Route = createFileRoute("/_portal/comprobacion")({
  // solicitudId: folio a dejar seleccionado al llegar (p. ej. desde "Comprobar gastos" en Estatus).
  validateSearch: (search: Record<string, unknown>): { solicitudId?: string } => {
    const solicitudId = typeof search.solicitudId === "string" ? search.solicitudId : undefined;
    return solicitudId ? { solicitudId } : {};
  },
  head: () => ({ meta: [{ title: "Comprobación — CKL" }] }),
  component: Comprobacion,
});

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

const RENGLON_BG: Record<string, string> = {
  comprobado: "#D8F3DC",
  parcialmente_comprobado: "#DBEAFE",
  pendiente: "#FEF3C7",
  no_aplica: "#F1F3F5",
};
const RENGLON_FG: Record<string, string> = {
  comprobado: "#2D6A4F",
  parcialmente_comprobado: "#1D4ED8",
  pendiente: "#B45309",
  no_aplica: "#666",
};

function Comprobacion() {
  const { user, role, hasPerm } = useAuth();
  // Compras Corporativas (validar_comprobacion, sin comprobar) revisa folios ya
  // comprobados: no sube ni elimina facturas, solo marca Validado y deja Notas.
  const puedeComprobar = hasPerm("comprobar");
  const validador = hasPerm("validar_comprobacion");
  const soloValidador = validador && !puedeComprobar;
  // Gestor de vuelos solo debe ver/comprobar el concepto "Avión" de cada
  // folio — el resto (Hotel, Transporte foráneo terrestre, Transporte local,
  // Comida, Vales) y las secciones de No deducibles/Depósito sobrante no le
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
  // El validador solo ve folios comprobados por completo (los que ya puede revisar).
  const cerradas = filterSolicitudesByOwnership(user, role, solicitudes, users)
    .filter((s) => s.estatus === "Cerrado")
    .filter((s) => !soloValidador || avanceComprobacion(comprobantes, s.id).completo);
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

  const [adjuntando, setAdjuntando] = useState<ComprobanteGasto | null>(null);

  // Procesa el comprobante de un concepto desde el diálogo "Adjuntar": para los conceptos
  // con factura exige el par XML + PDF y solo entonces suma al comprobado (el monto sale del
  // Total del XML); los vales llevan un solo archivo (foto o PDF). Si algo no valida no se
  // guarda nada. Devuelve true si se guardó (el diálogo se cierra).
  const subirComprobante = async (
    concepto: ComprobanteGasto,
    archivos: ArchivosComprobante,
  ): Promise<boolean> => {
    if (!sel) return false;
    const esVales = concepto.concepto === "Vales";
    if (esVales ? !archivos.pdf : !archivos.xml || !archivos.pdf) {
      showErrorDialog(
        esVales
          ? "Sube una foto o un PDF de los vales."
          : "Para comprobar este concepto debes subir el XML y el PDF juntos.",
      );
      return false;
    }
    for (const f of [archivos.xml, archivos.pdf]) {
      if (f && fs.some((x) => x.archivo === f.name)) {
        addLog(`✖ Archivo duplicado: ${f.name}`);
        showErrorDialog(`El archivo "${f.name}" ya fue cargado para esta solicitud.`);
        return false;
      }
    }

    const uuidv = uid("UUID-").toUpperCase();
    let total = Math.floor(Math.random() * 800) + 200; // simulado si el archivo no trae Total
    if (!esVales && archivos.xml) {
      const text = await archivos.xml.text();
      if (!text.includes("cfdi:Emisor") && !text.toLowerCase().includes("emisor")) {
        addLog("✖ Nodo cfdi:Emisor no encontrado");
        showErrorDialog("El XML no es un CFDI válido (falta el Emisor). No se guardó el comprobante.");
        return false;
      }
      const rfcMatch = text.match(/Receptor[^>]*Rfc=["']([^"']+)["']/i);
      const rfcEsperado = solSociedad?.rfc;
      if (rfcMatch && rfcEsperado && rfcMatch[1].toUpperCase() !== rfcEsperado.toUpperCase()) {
        addLog(`✖ RFC del Receptor no coincide (esperado: ${rfcEsperado})`);
        showErrorDialog(
          `El RFC del receptor del XML no coincide con la sociedad (${rfcEsperado}). No se guardó el comprobante.`,
        );
        return false;
      }
      // Total del CFDI (atributo Total del Comprobante; SubTotal no coincide por el \s previo)
      const t = text.match(/\sTotal=["']([0-9][0-9.,]*)["']/i);
      const leido = t ? parseFloat(t[1].replace(/,/g, "")) : NaN;
      if (leido > 0) total = leido;
    }

    const pendiente = concepto.monto_solicitado - concepto.monto_comprobado;
    const montoAplicado = Math.min(total, pendiente);
    if (montoAplicado <= 0) {
      showErrorDialog("Este concepto ya está comprobado por completo.");
      return false;
    }

    const fecha = new Date().toLocaleDateString("es-MX");
    const parId = esVales ? undefined : uid("par_");
    const base = { solicitud_id: sid, fecha, uuid: uuidv, total, status: "Verificado" as const, concepto_id: concepto.id, par_id: parId };
    const nuevas: Factura[] = [];
    if (!esVales && archivos.xml) {
      nuevas.push({
        ...base, id: uid("f_"), tipo: "XML", archivo: archivos.xml.name,
        monto_aplicado: montoAplicado, contenido: await readAsDataURL(archivos.xml),
      });
    }
    if (archivos.pdf) {
      nuevas.push({
        ...base, id: uid("f_"),
        tipo: esVales && /\.(jpe?g|png)$/i.test(archivos.pdf.name) ? "FOTO" : "PDF",
        archivo: archivos.pdf.name,
        monto_aplicado: esVales ? montoAplicado : 0,
        contenido: await readAsDataURL(archivos.pdf),
      });
    }
    setFacturas([...nuevas, ...facturas]);
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
    addLog(
      esVales
        ? `✔ Comprobante de vales cargado: ${archivos.pdf!.name}`
        : `✔ XML + PDF verificados para "${concepto.concepto}". UUID: ${uuidv} · Total ${fmtMoney(total)}`,
    );
    toast.success(`Comprobante de "${concepto.concepto}" cargado y verificado.`);
    return true;
  };

  // ── Validación de Compras Corporativas
  const actualizarRenglon = (id: string, patch: Partial<ComprobanteGasto>) =>
    setComprobantes(comprobantes.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const toggleValidado = (r: ComprobanteGasto) => {
    if (r.validado) {
      actualizarRenglon(r.id, { validado: false, validado_por: undefined, validado_fecha: undefined });
      toast.success(`Validación de "${r.concepto}" retirada.`);
    } else {
      actualizarRenglon(r.id, {
        validado: true,
        validado_por: user?.id,
        validado_fecha: new Date().toISOString().slice(0, 10),
      });
      toast.success(`"${r.concepto}" validado.`);
    }
  };

  const guardarNota = (r: ComprobanteGasto, texto: string) => {
    const t = texto.trim();
    if ((r.nota_validacion ?? "") === t) return;
    actualizarRenglon(r.id, { nota_validacion: t || undefined });
    toast.success("Nota guardada.");
  };

  // Elimina el comprobante completo (XML + PDF) y revierte lo que aplicó al renglón.
  const removeGrupo = (g: Factura[]) => {
    const ids = new Set(g.map((f) => f.id));
    const aplicado = g.reduce((a, f) => a + f.monto_aplicado, 0);
    const conceptoId = g.find((f) => f.concepto_id)?.concepto_id;
    setFacturas(facturas.filter((x) => !ids.has(x.id)));
    if (conceptoId && aplicado > 0) {
      setComprobantes(
        comprobantes.map((c) => {
          if (c.id !== conceptoId) return c;
          const nuevo = Math.max(0, c.monto_comprobado - aplicado);
          return {
            ...c,
            // Si el renglón deja de estar completo, la validación de Compras ya no aplica.
            ...(nuevo < c.monto_solicitado
              ? { validado: false, validado_por: undefined, validado_fecha: undefined }
              : {}),
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
    toast.success(g.length > 1 ? "Comprobante eliminado (XML y PDF)." : "Archivo eliminado.");
  };

  if (!sel)
    return (
      <div className="ckl-card p-8 text-center text-sm text-muted-foreground">
        {soloValidador
          ? "No hay folios comprobados por validar."
          : "No hay solicitudes cerradas para comprobar."}
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
  const validacionDe = (solicitudId: string) => avanceValidacion(comprobantes, solicitudId);
  const validacion = validacionDe(sid);
  const insignia = !comprobado
    ? { texto: "Pendiente de comprobar", bg: "#FEF3C7", fg: "#B45309" }
    : validacion.completa
      ? { texto: "Validado por Compras", bg: "#BBF7D0", fg: "#14532D" }
      : { texto: soloValidador ? "Por validar" : "Comprobado", bg: "#D8F3DC", fg: "#2D6A4F" };
  const duenoDe = (s: Solicitud) => users.find((u) => u.id === s.user_id)?.nombre ?? "—";
  const nombreDe = (id?: string) => users.find((u) => u.id === id)?.nombre ?? "Compras";
  // Un renglón solo se puede validar cuando ya está comprobado por completo.
  const validable = (r: ComprobanteGasto) => r.monto_solicitado > 0 && r.status_renglon === "comprobado";

  const celdaValidado = (r: ComprobanteGasto) => {
    if (validador && validable(r)) {
      return (
        <label className="inline-flex cursor-pointer items-center p-1.5" title="Marcar como validado">
          <input
            type="checkbox"
            className="h-5 w-5 cursor-pointer accent-[#2D6A4F]"
            checked={!!r.validado}
            onChange={() => toggleValidado(r)}
            aria-label={`Validar ${r.concepto}`}
          />
        </label>
      );
    }
    return r.validado ? (
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold"
        style={{ color: "#2D6A4F" }}
        title={`Validado por ${nombreDe(r.validado_por)}${r.validado_fecha ? " el " + r.validado_fecha : ""}`}
      >
        <CheckCircle2 size={16} /> Validado
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  };

  const celdaNota = (r: ComprobanteGasto) => {
    if (validador && validable(r)) {
      return (
        <input
          // key con la nota guardada: el campo se refresca si cambia desde otro lado
          key={r.id + "|" + (r.nota_validacion ?? "")}
          className="ckl-input min-w-[150px]"
          defaultValue={r.nota_validacion ?? ""}
          placeholder="Observación (opcional)"
          maxLength={300}
          onBlur={(e) => guardarNota(r, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      );
    }
    return r.nota_validacion ? (
      <span
        className="inline-block max-w-[260px] rounded px-2 py-1 text-xs"
        style={{ background: "#FEF3C7", color: "#92400E" }}
      >
        {r.nota_validacion}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  };

  const botonesAdjuntar = (r: ComprobanteGasto) => {
    const cerrado = r.status_renglon === "comprobado" || r.status_renglon === "no_aplica";
    if (cerrado || !puedeComprobar) return <span className="text-xs text-muted-foreground">—</span>;
    const esVales = r.concepto === "Vales";
    return (
      <button
        onClick={() => setAdjuntando(r)}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary"
        style={{ color: "var(--color-primary)", borderColor: "var(--color-primary)" }}
        title={esVales ? "Adjuntar foto o PDF de los vales" : "Adjuntar XML y PDF"}
        aria-label={`Adjuntar comprobante de ${r.concepto}`}
      >
        <Paperclip size={14} /> Adjuntar
      </button>
    );
  };
  // Un comprobante = XML + PDF (par) o un archivo suelto (vales / heredado).
  const grupos = agruparFacturas(fs);
  const estadoGrupo = (g: Factura[]) => {
    const concepto = comprobantes.find((c) => c.id === g[0].concepto_id)?.concepto ?? "";
    if (g.some((f) => f.status === "Incompleto") || (g.length === 1 && concepto && conceptoRequierePar(concepto) && !g[0].par_id && g[0].status !== "Error")) {
      const falta = g[0].tipo === "XML" ? "PDF" : "XML";
      return { texto: `Incompleto · falta ${falta}`, bg: "#FEF3C7", fg: "#B45309" };
    }
    if (g.some((f) => f.status === "Error")) return { texto: "Error", bg: "#FEE9EA", fg: "#E30613" };
    return { texto: "Verificado", bg: "#D8F3DC", fg: "#2D6A4F" };
  };
  const badgeRenglon = (r: ComprobanteGasto) => (
    <span
      className="ckl-badge"
      style={{ background: RENGLON_BG[r.status_renglon], color: RENGLON_FG[r.status_renglon] }}
    >
      {r.status_renglon.replace(/_/g, " ")}
    </span>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <FolioPicker
        solicitudes={cerradas}
        selectedId={sid}
        avanceDe={avanceDe}
        validacionDe={validacionDe}
        soloValidador={soloValidador}
        duenoDe={new Set(cerradas.map((c) => c.user_id)).size > 1 ? duenoDe : undefined}
        onSelect={selectFolio}
      />
      <div className="min-w-0 space-y-5">
      <div className="ckl-card p-4 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{sel.folio}</span> · {duenoDe(sel)} ·{" "}
        {sel.empresa} · {sel.tipo_viaje} · {sel.fecha}
      </div>

      {/* Tabla */}
      <div className="ckl-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <span className="text-sm font-semibold">Tabla de comprobación</span>
          <div className="flex flex-wrap items-center gap-2">
            {comprobado && validacion.total > 0 && (
              <span className="text-xs text-muted-foreground">
                Validados {validacion.validados} de {validacion.total}
              </span>
            )}
            <span className="ckl-badge" style={{ background: insignia.bg, color: insignia.fg }}>
              {insignia.texto}
            </span>
          </div>
        </div>
        {soloValidador && (
          <p className="border-b bg-secondary/50 px-4 py-2 text-xs text-muted-foreground">
            Revisa las facturas en <b>Facturas cargadas</b> (ver / descargar), marca <b>Validado</b>{" "}
            en cada concepto cuando sean correctas y deja una <b>Nota</b> si hay observaciones.
          </p>
        )}

        {/* Móvil (< 768 px): tarjetas apiladas en lugar de tabla de 8 columnas. */}
        <ul className="divide-y md:hidden">
          {rows.map((r) => {
            const dif = r.monto_comprobado - r.monto_solicitado;
            return (
              <li key={r.id} className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{r.concepto}</span>
                  {badgeRenglon(r)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Solicitado</div>
                    <div className="font-semibold">{fmtMoney(r.monto_solicitado)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Comprobado</div>
                    <div className="font-semibold">{fmtMoney(r.monto_comprobado)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Dif.</div>
                    <div className="font-semibold" style={{ color: dif < 0 ? "#E30613" : "#2D6A4F" }}>
                      {fmtMoney(dif)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Validado</span>
                    {celdaValidado(r)}
                  </div>
                  {!soloValidador && botonesAdjuntar(r)}
                </div>
                <div>{celdaNota(r)}</div>
              </li>
            );
          })}
          <li className="flex justify-between bg-secondary p-3 text-sm font-semibold">
            <span>Totales</span>
            <span>
              {fmtMoney(totComp)} / {fmtMoney(totSol)}
            </span>
          </li>
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Concepto</th>
                <th className="p-3 text-right">Solicitado</th>
                <th className="p-3 text-right">Comprobado</th>
                <th className="p-3 text-right">Dif.</th>
                <th className="p-3">Estatus</th>
                <th className="p-3">Validado</th>
                <th className="p-3">Nota</th>
                {!soloValidador && <th className="p-3">Adjuntar</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dif = r.monto_comprobado - r.monto_solicitado;
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
                    <td className="p-3">{badgeRenglon(r)}</td>
                    <td className="p-3">{celdaValidado(r)}</td>
                    <td className="p-3">{celdaNota(r)}</td>
                    {!soloValidador && <td className="p-3">{botonesAdjuntar(r)}</td>}
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
                <td></td>
                {!soloValidador && <td></td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Validación */}
      {puedeComprobar && (
      <div className="ckl-card p-4">
        <div className="text-sm font-semibold">Validación de comprobantes</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Presiona <b>Adjuntar</b> en el concepto y sube el <b>XML y el PDF juntos</b>: solo cuando
          están los dos archivos el comprobante cuenta y suma a lo comprobado. Los <b>vales</b> se
          comprueban con una sola foto o PDF (sin XML). La gasolina no se comprueba.
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

      )}

      <div className="ckl-card overflow-hidden">
        <div className="border-b p-4 text-sm font-semibold">Facturas cargadas</div>
        {/* Móvil (< 768 px): tarjetas apiladas en lugar de tabla de 8 columnas. */}
        <ul className="divide-y md:hidden">
          {grupos.length === 0 && (
            <li className="p-6 text-center text-xs text-muted-foreground">Sin facturas</li>
          )}
          {grupos.map((g) => {
            const f = g[0];
            const concepto = comprobantes.find((c) => c.id === f.concepto_id)?.concepto ?? "—";
            const est = estadoGrupo(g);
            return (
              <li key={f.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {g.map((x) => (
                      <span key={x.id} className="ckl-badge" style={{ background: "#F1F3F5", color: "#333" }}>
                        {x.tipo}
                      </span>
                    ))}
                    <span className="text-sm font-medium">{concepto}</span>
                  </div>
                  <span className="ckl-badge" style={{ background: est.bg, color: est.fg }}>
                    {est.texto}
                  </span>
                </div>
                {g.map((x) => (
                  <div key={x.id} className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 break-all text-xs">{x.archivo}</span>
                    <span className="flex shrink-0 gap-0.5">
                      <button title="Ver" aria-label={`Ver ${x.tipo}`} className="rounded p-2 hover:bg-secondary" onClick={() => verFactura(x)}>
                        <Eye size={16} />
                      </button>
                      <button title="Descargar" aria-label={`Descargar ${x.tipo}`} className="rounded p-2 hover:bg-secondary" onClick={() => descargarFactura(x)}>
                        <Download size={16} />
                      </button>
                    </span>
                  </div>
                ))}
                <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{f.uuid}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {f.fecha} · <b className="text-foreground">{fmtMoney(f.total)}</b>
                  </span>
                  {puedeComprobar && (
                    <button title="Eliminar" aria-label="Eliminar comprobante" className="rounded p-2 hover:bg-secondary" onClick={() => removeGrupo(g)}>
                      <Trash2 size={16} />
                    </button>
                  )}
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
              {grupos.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-xs text-muted-foreground">
                    Sin facturas
                  </td>
                </tr>
              )}
              {grupos.map((g) => {
                const f = g[0];
                const concepto = comprobantes.find((c) => c.id === f.concepto_id)?.concepto ?? "—";
                const est = estadoGrupo(g);
                return (
                  <tr key={f.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        {g.map((x) => (
                          <span key={x.id} className="ckl-badge" style={{ background: "#F1F3F5", color: "#333" }}>
                            {x.tipo}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-xs">{concepto}</td>
                    <td className="p-3 text-xs">{f.fecha}</td>
                    <td className="p-3 font-mono text-[11px]">{f.uuid}</td>
                    <td className="p-3 text-xs">
                      {g.map((x) => (
                        <div key={x.id} className="py-0.5">{x.archivo}</div>
                      ))}
                    </td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(f.total)}</td>
                    <td className="p-3">
                      <span className="ckl-badge" style={{ background: est.bg, color: est.fg }}>
                        {est.texto}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-start gap-2">
                        <div className="space-y-0.5">
                          {g.map((x) => (
                            <div key={x.id} className="flex items-center gap-0.5">
                              <button title="Ver" aria-label={`Ver ${x.tipo}`} className="rounded p-1 hover:bg-secondary" onClick={() => verFactura(x)}>
                                <Eye size={14} />
                              </button>
                              <button title="Descargar" aria-label={`Descargar ${x.tipo}`} className="rounded p-1 hover:bg-secondary" onClick={() => descargarFactura(x)}>
                                <Download size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                        {puedeComprobar && (
                          <button
                            title="Eliminar"
                            aria-label="Eliminar comprobante"
                            className="rounded p-1 hover:bg-secondary"
                            onClick={() => removeGrupo(g)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!soloAvion && puedeComprobar && (
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
      {adjuntando && (
        <SubirComprobanteDialog
          renglon={adjuntando}
          onClose={() => setAdjuntando(null)}
          onSubir={(a) => subirComprobante(adjuntando, a)}
        />
      )}
    </div>
  );
}

// Panel maestro: tarjetas de folios con buscador y barra de avance de comprobación.
// En móvil (< 1024 px) se colapsa al folio elegido y se despliega con "Cambiar folio".
function FolioPicker({
  solicitudes,
  selectedId,
  avanceDe,
  validacionDe,
  soloValidador,
  duenoDe,
  onSelect,
}: {
  solicitudes: Solicitud[];
  selectedId: string;
  avanceDe: (solicitudId: string) => ReturnType<typeof avanceComprobacion>;
  validacionDe: (solicitudId: string) => ReturnType<typeof avanceValidacion>;
  soloValidador: boolean;
  duenoDe?: (s: Solicitud) => string;
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
    const v = validacionDe(s.id);
    const activo = s.id === selectedId;
    const tag = !a.completo
      ? { t: "Pendiente", bg: "#FEF3C7", fg: "#B45309" }
      : v.completa
        ? { t: "Validado", bg: "#BBF7D0", fg: "#14532D" }
        : { t: soloValidador ? "Por validar" : "Comprobado", bg: "#D8F3DC", fg: "#2D6A4F" };
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
            style={{ background: tag.bg, color: tag.fg }}
          >
            {a.completo && <CheckCircle2 size={11} />}[{tag.t}]
          </span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">{s.destino_resumen}</div>
        {duenoDe && <div className="truncate text-xs text-muted-foreground">{duenoDe(s)}</div>}
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
