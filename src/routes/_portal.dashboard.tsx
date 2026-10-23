import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, CheckCircle2, AlertTriangle, FileText, Download, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  KEYS,
  lsGet,
  fmtMoney,
  filterSolicitudesByOwnership,
  filterSolicitudesByDateCutoff,
  avanceComprobacion,
  estatusVisible,
  type Solicitud,
  type Sociedad,
  type User,
  type ComprobanteGasto,
} from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/_portal/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Portal CKL" }] }),
  component: Dashboard,
});

type KpiProps = {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: number;
  color: string;
  bg: string;
};

function Kpi({ icon: Icon, label, value, color, bg }: KpiProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-3xl px-4 py-7 text-center"
      style={{ background: bg }}
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full border-2"
        style={{ borderColor: color, color }}
      >
        <Icon size={20} />
      </div>
      <div className="text-3xl font-bold leading-none" style={{ color }}>
        {value}
      </div>
      <div className="text-[13px] font-medium" style={{ color }}>
        {label}
      </div>
    </div>
  );
}

// Rampa secuencial de un solo tono (el rojo de marca): más claro = monto menor,
// más saturado/oscuro = monto mayor. Mismo hue/chroma que --primary (27.5).
function seqColor(ratio: number) {
  const l = 0.88 - ratio * 0.43;
  const c = 0.03 + ratio * 0.19;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 27.5)`;
}

// Redondea un paso de eje al múltiplo "bonito" más cercano (1/2/2.5/5/10 × 10^n),
// el mismo criterio que usan las librerías de charting para elegir gridlines.
function niceAxisStep(rawStep: number) {
  if (rawStep <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return niceNorm * mag;
}

function fmtAxisTick(v: number) {
  return v === 0 ? "$0" : `$${Math.round(v / 1000)}k`;
}

function MonthlyChart({ data }: { data: { mes: string; total: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Sin datos para mostrar.
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.total));
  const step = niceAxisStep(max / 4);
  const niceMax = step * 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => step * i);
  const barAreaHeight = 170;

  return (
    <div className="flex gap-3 pt-6">
      <div
        className="flex shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground"
        style={{ height: barAreaHeight }}
      >
        {ticks.map((tick, i) => (
          <div key={i}>{fmtAxisTick(tick)}</div>
        ))}
      </div>
      <div className="relative flex-1">
        <div
          className="absolute inset-x-0 top-0 flex flex-col justify-between"
          style={{ height: barAreaHeight }}
        >
          {ticks.map((_, i) => (
            <div key={i} className="h-px w-full bg-border" />
          ))}
        </div>
        <div
          className="relative flex items-end justify-around gap-4"
          style={{ height: barAreaHeight }}
        >
          {data.map((d) => {
            const ratio = d.total / niceMax;
            const height = Math.max(4, ratio * barAreaHeight);
            const isMax = d.total === max;
            const color = isMax ? "var(--color-primary)" : seqColor(0.22);
            return (
              <div
                key={d.mes}
                className="relative flex h-full flex-1 flex-col items-center justify-end"
              >
                <div
                  className="absolute whitespace-nowrap text-xs font-semibold"
                  style={{ bottom: height + 6 }}
                >
                  {fmtMoney(d.total)}
                </div>
                <div
                  className="w-full max-w-14 outline-none"
                  style={{ height, background: color, borderRadius: "6px 6px 2px 2px" }}
                  tabIndex={0}
                  role="img"
                  aria-label={`${d.mes}: ${fmtMoney(d.total)}`}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-around gap-4">
          {data.map((d) => (
            <div
              key={d.mes}
              className="flex-1 text-center text-[11px] font-medium uppercase text-muted-foreground"
            >
              {d.mes}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const { user, role } = useAuth();
  const allSolicitudes = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  const sociedades = lsGet<Sociedad[]>(KEYS.sociedades, []);
  const users = lsGet<User[]>(KEYS.users, []);
  const comprobantesGasto = lsGet<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
  const mySoc = sociedades.find((s) => s.nombre === user?.empresa);
  const config = lsGet<{ dias_comprobacion_atrasada?: number }>(KEYS.config, {});
  const diasComprobacionAtrasada = config.dias_comprobacion_atrasada ?? 7;

  // Mismo criterio que usan "Estatus" y "Comprobación": comprobado solo
  // cuando el total comprobado iguala al total solicitado en todos sus
  // renglones (no basta con que se haya subido el comprobante de viaje).
  const estaComprobado = (solicitudId: string) =>
    avanceComprobacion(comprobantesGasto, solicitudId).completo;

  // Usuario: solo sus propias solicitudes. Jefe inmediato: solo las de su equipo.
  // Administrador/Finanzas/Compras corporativas (y roles con "ver todo"): todas.
  const solicitudes = filterSolicitudesByOwnership(user, role, allSolicitudes, users);

  const now = new Date();
  const inMonth = (d: string) => {
    const dt = new Date(d);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  };

  // "Ver comprobaciones atrasadas" lleva a Estatus, que solo muestra folios
  // dentro de su ventana de fechas visible (2-4 meses según el rol) — se
  // cuenta con ese mismo límite para que el número coincida con lo que esa
  // pantalla realmente va a mostrar.
  const solicitudesVisiblesEnEstatus = filterSolicitudesByDateCutoff(solicitudes, role?.nombre);

  const kpis = {
    pendientes: solicitudes.filter((s) => s.jefe_status === "Pendiente").length,
    autorizados: solicitudes.filter((s) => s.estatus === "Cerrado" && inMonth(s.created_at)).length,
    atrasados: solicitudesVisiblesEnEstatus.filter(
      (s) =>
        s.estatus === "Cerrado" &&
        !estaComprobado(s.id) &&
        (Date.now() - new Date(s.created_at).getTime()) / 86400000 > diasComprobacionAtrasada,
    ).length,
    enTiempo: solicitudes.filter((s) => s.estatus === "Cerrado" && s.comprobante_viaje).length,
    porComprobar: solicitudes.filter((s) => s.estatus === "Cerrado" && !s.comprobante_viaje).length,
  };

  // chart data: group by month, ordenado cronológicamente (no por orden de aparición)
  const byMonth: Record<string, { label: string; total: number }> = {};
  for (const s of solicitudes) {
    const d = new Date(s.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("es-MX", { month: "short" });
    if (!byMonth[key]) byMonth[key] = { label, total: 0 };
    byMonth[key].total += s.monto_total;
  }
  const chart = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ mes: v.label, total: v.total }));

  const recientes = [...solicitudes]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const userName = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";

  return (
    <div className="space-y-5">
      {kpis.atrasados > 0 && (
        <div
          className="flex flex-col gap-4 rounded-3xl p-5 sm:flex-row sm:items-center sm:justify-between"
          style={{ background: "#FEE9EA" }}
        >
          <div className="flex items-center gap-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: "var(--color-primary)" }}
            >
              <AlertTriangle size={22} />
            </div>
            <div>
              <div className="font-bold">
                {kpis.atrasados} comprobaci{kpis.atrasados === 1 ? "ón" : "ones"} atrasada
                {kpis.atrasados === 1 ? "" : "s"}: más de {diasComprobacionAtrasada} días sin
                comprobar
              </div>
              <div className="text-sm" style={{ color: "var(--color-primary-hover)" }}>
                Requieren atención inmediata antes del cierre contable.
              </div>
            </div>
          </div>
          <Link
            to="/estatus"
            search={{ atrasados: true }}
            className="shrink-0 rounded-full px-5 py-2.5 text-center text-sm font-semibold text-white"
            style={{ background: "var(--color-primary)" }}
          >
            Ver comprobaciones atrasadas
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Kpi
          icon={Clock}
          label="Por autorizar"
          value={kpis.pendientes}
          color="#B45309"
          bg="#FEF3C7"
        />
        <Kpi
          icon={CheckCircle2}
          label="Autorizados del mes"
          value={kpis.autorizados}
          color="#2D6A4F"
          bg="#D8F3DC"
        />
        <Kpi icon={Clock} label="En tiempo" value={kpis.enTiempo} color="#1D4ED8" bg="#DBEAFE" />
        <Kpi
          icon={FileText}
          label="Por comprobar"
          value={kpis.porComprobar}
          color="#525252"
          bg="#F1F1F1"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="ckl-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Viáticos por mes</div>
              <div className="text-xs text-muted-foreground">Total depositado agrupado por mes</div>
            </div>
          </div>
          <div className="h-64">
            <MonthlyChart data={chart} />
          </div>
        </div>
        <div className="ckl-card p-5">
          <div className="text-sm font-semibold">Cédula Fiscal</div>
          {mySoc ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <Field k="Razón social" v={mySoc.nombre} />
                <Field k="RFC" v={mySoc.rfc} />
                <Field k="Régimen" v={mySoc.regimen} />
                <Field k="CP" v={mySoc.cp} />
                <Field k="Uso CFDI" v={mySoc.UsoCFDI} />
                <Field k="Sociedad SAP" v={mySoc.sociedad_sap} />
              </div>
              <button
                onClick={() => toast.success("PDF descargado.")}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold"
                style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
              >
                <Download size={15} /> Descargar cédula en PDF
              </button>
            </>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Sin sociedad asignada.</p>
          )}
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <div className="text-sm font-semibold">Solicitudes recientes</div>
          <Link
            to="/estatus"
            className="flex items-center gap-0.5 text-xs font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            Ver todas <ChevronRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Folio</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Usuario</th>
                <th className="p-3">Destino</th>
                <th className="p-3 text-right">Monto</th>
                <th className="p-3">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {recientes.map((s) => {
                const ok =
                  s.jefe_status === "Autorizado" &&
                  (s.finanzas_status === "Autorizado" || s.finanzas_status === "N/A");
                const bad = s.jefe_status === "Rechazado" || s.finanzas_status === "Rechazado";
                const stripe = bad ? "#E30613" : ok ? "#2D6A4F" : "#CCC";
                return (
                  <tr key={s.id} className="border-t" style={{ borderLeft: `3px solid ${stripe}` }}>
                    <td className="p-3 font-mono text-xs">{s.folio}</td>
                    <td className="p-3 text-xs">{s.fecha}</td>
                    <td className="p-3">{userName(s.user_id)}</td>
                    <td className="p-3 text-xs">{s.destino_resumen}</td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(s.monto_total)}</td>
                    <td className="p-3">
                      <StatusBadge estatus={s.estatus} comprobado={estaComprobado(s.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}

// `estatus` acepta el valor interno de la solicitud (Abierto/Cerrado/Rechazado)
// o un estado de paso (Pendiente/Autorizado/N/A de Jefe/Finanzas). El valor
// interno se traduce a la etiqueta visible: Abierto → Pendiente, Rechazado →
// Rechazado y Cerrado → Autorizado (azul) o Comprobado (verde) según `comprobado`.
export function StatusBadge({
  estatus,
  comprobado = false,
}: {
  estatus: string;
  comprobado?: boolean;
}) {
  const interno = estatus === "Abierto" || estatus === "Cerrado" || estatus === "Rechazado";
  const label = interno ? estatusVisible(estatus, comprobado) : estatus;
  const m: Record<string, { bg: string; color: string }> = {
    Comprobado: { bg: "#D8F3DC", color: "#2D6A4F" },
    // Autorizado a nivel solicitud (aún falta comprobar): azul suave, para no
    // confundirlo con el "Autorizado" verde de los pasos Jefe/Finanzas.
    AutorizadoSolicitud: { bg: "#DBEAFE", color: "#1D4ED8" },
    Pendiente: { bg: "#FEF3C7", color: "#B45309" },
    Rechazado: { bg: "#FEE9EA", color: "#E30613" },
    Autorizado: { bg: "#D8F3DC", color: "#2D6A4F" },
    "N/A": { bg: "#F1F3F5", color: "#666" },
  };
  const key = interno && label === "Autorizado" ? "AutorizadoSolicitud" : label;
  const s = m[key] ?? m.Pendiente;
  return (
    <span className="ckl-badge" style={{ background: s.bg, color: s.color }}>
      {label}
    </span>
  );
}
