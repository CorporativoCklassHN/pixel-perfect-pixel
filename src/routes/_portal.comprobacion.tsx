import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Upload, FileText, FileCode, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocalStorage } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import { KEYS, fmtMoney, uid, type Solicitud, type ComprobanteGasto, type Sociedad } from "@/lib/store";

export const Route = createFileRoute("/_portal/comprobacion")({
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
};

function Comprobacion() {
  const [solicitudes] = useLocalStorage<Solicitud[]>(KEYS.solicitudes, []);
  const [sociedades] = useLocalStorage<Sociedad[]>(KEYS.sociedades, []);
  const [comprobantes, setComprobantes] = useLocalStorage<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
  const [facturas, setFacturas] = useLocalStorage<Factura[]>(KEYS.facturasXml, []);
  const cerradas = solicitudes.filter((s) => s.estatus === "Cerrado");
  const [sid, setSid] = useState<string>(cerradas[0]?.id ?? "");
  const sel = solicitudes.find((s) => s.id === sid);
  // Cada usuario factura a la Sociedad (razón social) con la que solicitó el
  // viático, no a su propio RFC personal — el Receptor del CFDI debe ser esa
  // sociedad.
  const solSociedad = sociedades.find((so) => so.nombre === sel?.empresa);
  const rows = useMemo(() => comprobantes.filter((c) => c.solicitud_id === sid), [comprobantes, sid]);
  const fs = useMemo(() => facturas.filter((f) => f.solicitud_id === sid), [facturas, sid]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (line: string) => setLog((l) => [`${new Date().toTimeString().slice(0, 8)} ${line}`, ...l].slice(0, 50));

  const onFile = (kind: "XML" | "PDF") => {
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
      let total = Math.floor(Math.random() * 800) + 200;
      let status: "Verificado" | "Error" = "Verificado";
      let uuidv = uid("UUID-").toUpperCase();
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
            addLog(`✔ XML verificado CFDI 4.0. UUID: ${uuidv}`);
          }
        }
      } else {
        addLog(`✔ PDF cargado: ${file.name}`);
      }
      let conceptoId: string | null = null;
      let montoAplicado = 0;
      if (status === "Verificado") {
        // Increase a hotel/other to simulate
        const pendiente = rows.find((r) => r.status_renglon !== "comprobado");
        if (pendiente) {
          conceptoId = pendiente.id;
          montoAplicado = Math.min(total, pendiente.monto_solicitado - pendiente.monto_comprobado);
          setComprobantes(
            comprobantes.map((c) =>
              c.id === pendiente.id
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
        }
        toast.success("Comprobante cargado y verificado.");
      } else {
        showErrorDialog("Error de validación. Revisa el log.");
      }
      const factura: Factura = {
        id: uid("f_"), solicitud_id: sid, tipo: kind,
        fecha: new Date().toLocaleDateString("es-MX"),
        uuid: uuidv, archivo: file.name, total, status,
        concepto_id: conceptoId, monto_aplicado: montoAplicado,
      };
      setFacturas([factura, ...facturas]);
    };
    inp.click();
  };

  const removeFactura = (id: string) => {
    const f = facturas.find((x) => x.id === id);
    setFacturas(facturas.filter((x) => x.id !== id));
    if (f?.concepto_id && f.monto_aplicado > 0) {
      setComprobantes(comprobantes.map((c) => {
        if (c.id !== f.concepto_id) return c;
        const nuevo = Math.max(0, c.monto_comprobado - f.monto_aplicado);
        return {
          ...c,
          monto_comprobado: nuevo,
          status_renglon: nuevo <= 0 ? "pendiente" : nuevo >= c.monto_solicitado ? "comprobado" : "parcialmente_comprobado",
        };
      }));
    }
    toast.success("Factura eliminada.");
  };

  if (!sel) return <div className="ckl-card p-8 text-center text-sm text-muted-foreground">No hay solicitudes cerradas para comprobar.</div>;

  const totSol = rows.reduce((a, r) => a + r.monto_solicitado, 0);
  const totComp = rows.reduce((a, r) => a + r.monto_comprobado, 0);
  // Estatus global: comprobado solo cuando el total comprobado iguala al total solicitado.
  const comprobado = totSol > 0 && totComp === totSol;

  return (
    <div className="space-y-5">
      <div className="ckl-card p-4">
        <label className="ckl-label">Folio</label>
        <select className="ckl-input max-w-md" value={sid} onChange={(e) => setSid(e.target.value)}>
          {cerradas.map((s) => <option key={s.id} value={s.id}>{s.folio} — {s.destino_resumen} ({fmtMoney(s.monto_total)})</option>)}
        </select>
        <div className="mt-2 text-xs text-muted-foreground">{sel.empresa} · {sel.tipo_viaje} · {sel.fecha}</div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Tabla */}
        <div className="ckl-card overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <span className="text-sm font-semibold">Tabla de comprobación</span>
            <span
              className="ckl-badge"
              style={{ background: comprobado ? "#D8F3DC" : "#FEF3C7", color: comprobado ? "#2D6A4F" : "#B45309" }}
            >
              {comprobado ? "Comprobado" : "Pendiente de comprobar"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Concepto</th><th className="p-3 text-right">Solicitado</th><th className="p-3 text-right">Comprobado</th><th className="p-3 text-right">Dif.</th><th className="p-3">Estatus</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dif = r.monto_comprobado - r.monto_solicitado;
                  const bg: Record<string, string> = { comprobado: "#D8F3DC", parcialmente_comprobado: "#DBEAFE", pendiente: "#FEF3C7", no_aplica: "#F1F3F5" };
                  const fg: Record<string, string> = { comprobado: "#2D6A4F", parcialmente_comprobado: "#1D4ED8", pendiente: "#B45309", no_aplica: "#666" };
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-3">{r.concepto}</td>
                      <td className="p-3 text-right">{fmtMoney(r.monto_solicitado)}</td>
                      <td className="p-3 text-right">{fmtMoney(r.monto_comprobado)}</td>
                      <td className="p-3 text-right font-semibold" style={{ color: dif < 0 ? "#E30613" : "#2D6A4F" }}>{fmtMoney(dif)}</td>
                      <td className="p-3"><span className="ckl-badge" style={{ background: bg[r.status_renglon], color: fg[r.status_renglon] }}>{r.status_renglon.replace(/_/g, " ")}</span></td>
                    </tr>
                  );
                })}
                <tr className="border-t bg-secondary font-semibold">
                  <td className="p-3">Totales</td>
                  <td className="p-3 text-right">{fmtMoney(totSol)}</td>
                  <td className="p-3 text-right">{fmtMoney(totComp)}</td>
                  <td className="p-3 text-right">{fmtMoney(totComp - totSol)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Adjuntar */}
        <div className="ckl-card p-4">
          <div className="text-sm font-semibold">Adjuntar comprobantes</div>
          <div className="mt-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-[color:var(--color-primary)]">
            <Upload size={28} className="mx-auto text-muted-foreground" />
            <p className="mt-2 text-sm">Arrastra archivos o usa los botones.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => onFile("XML")} className="ckl-btn-primary"><FileCode size={14} /> XML — CFDI 4.0</button>
              <button onClick={() => onFile("PDF")} className="ckl-btn-outline"><FileText size={14} /> PDF — Impreso</button>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Log de validación</div>
            <div className="max-h-[120px] overflow-auto rounded-md border bg-secondary p-2 font-mono text-[11px]">
              {log.length === 0 ? <span className="text-muted-foreground">Sin actividad…</span> : log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="border-b p-4 text-sm font-semibold">Facturas cargadas</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Tipo</th><th className="p-3">Fecha</th><th className="p-3">UUID</th><th className="p-3">Archivo</th><th className="p-3 text-right">Total</th><th className="p-3">Estatus</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {fs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-xs text-muted-foreground">Sin facturas</td></tr>}
              {fs.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="p-3"><span className="ckl-badge" style={{ background: "#F1F3F5", color: "#333" }}>{f.tipo}</span></td>
                  <td className="p-3 text-xs">{f.fecha}</td>
                  <td className="p-3 font-mono text-[11px]">{f.uuid}</td>
                  <td className="p-3 text-xs">{f.archivo}</td>
                  <td className="p-3 text-right font-semibold">{fmtMoney(f.total)}</td>
                  <td className="p-3"><span className="ckl-badge" style={{ background: f.status === "Verificado" ? "#D8F3DC" : "#FEE9EA", color: f.status === "Verificado" ? "#2D6A4F" : "#E30613" }}>{f.status}</span></td>
                  <td className="p-3">
                    <button className="rounded p-1 hover:bg-secondary" onClick={() => toast.info("Modo demo: edición no disponible.")}><Edit2 size={14} /></button>
                    <button className="rounded p-1 hover:bg-secondary" onClick={() => removeFactura(f.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="ckl-card p-4">
          <div className="text-sm font-semibold">No deducibles</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <input className="ckl-input" placeholder="Monto" />
            <input className="ckl-input" placeholder="Establecimiento" />
            <input className="ckl-input" placeholder="Lugar" />
          </div>
          <button className="ckl-btn-outline mt-3" onClick={() => toast.success("Foto adjunta.")}><Upload size={14} /> Adjuntar foto</button>
        </div>
        <div className="ckl-card p-4" style={{ borderLeft: "4px solid var(--color-primary)" }}>
          <div className="text-sm font-semibold">Depósito sobrante</div>
          <div className="mt-2 rounded-md p-2 text-xs" style={{ background: "#FEF3C7", color: "#D97706" }}>
            Es obligatorio reintegrar el sobrante con comprobante bancario.
          </div>
          <div className="mt-3 flex gap-2">
            <input className="ckl-input" placeholder="Monto a reintegrar" />
            <button className="ckl-btn-primary" onClick={() => toast.success("Comprobante bancario cargado.")}><Upload size={14} /> Cargar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
