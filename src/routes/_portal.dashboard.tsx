import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, CheckCircle2, AlertTriangle, ClockArrowDown, FileText, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  KEYS,
  lsGet,
  fmtMoney,
  filterSolicitudesByOwnership,
  type Solicitud,
  type Sociedad,
  type User,
} from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/_portal/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Portal CKL" }] }),
  component: Dashboard,
});

function Kpi({ icon: Icon, label, value, color, bg, hint }: any) {
  return (
    <div className="ckl-card flex items-center gap-3 px-3.5 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-md" style={{ background: bg, color }}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <div className="text-[22px] font-bold leading-none">{value}</div>
        <div className="mt-1 text-[10.5px] text-muted-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[10px]" style={{ color }}>{hint}</div>}
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

function MonthlyPillChart({ data }: { data: { mes: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const trackHeight = 168;

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Sin datos para mostrar.
      </div>
    );
  }

  return (
    <div className="flex h-full items-end justify-center gap-4 px-2 pb-1 pt-8 sm:gap-6">
      {data.map((d) => {
        const ratio = d.total / max;
        const fillHeight = Math.max(10, ratio * trackHeight);
        const color = seqColor(ratio);
        return (
          <div key={d.mes} className="flex flex-col items-center">
            <div className="mb-1 whitespace-nowrap text-xs font-semibold">{fmtMoney(d.total)}</div>
            <div
              className="relative w-7 cursor-pointer rounded-full outline-none transition-transform hover:scale-105 focus-visible:scale-105"
              style={{ height: trackHeight, background: "var(--color-primary-soft)" }}
              tabIndex={0}
              role="img"
              aria-label={`${d.mes}: ${fmtMoney(d.total)}`}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-full"
                style={{ height: fillHeight, background: color }}
              />
              <div
                className="absolute left-1/2 h-4 w-4 -translate-x-1/2 rounded-full"
                style={{ bottom: fillHeight - 8, background: color, boxShadow: "0 0 0 3px var(--color-card)" }}
              />
            </div>
            <div className="mt-2 text-[11px] font-medium uppercase text-muted-foreground">{d.mes}</div>
          </div>
        );
      })}
    </div>
  );
}

function Dashboard() {
  const { user, role } = useAuth();
  const allSolicitudes = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  const sociedades = lsGet<Sociedad[]>(KEYS.sociedades, []);
  const users = lsGet<User[]>(KEYS.users, []);
  const mySoc = sociedades.find((s) => s.nombre === user?.empresa);

  // Usuario: solo sus propias solicitudes. Jefe inmediato: solo las de su equipo.
  // Administrador/Finanzas/Compras corporativas (y roles con "ver todo"): todas.
  const solicitudes = filterSolicitudesByOwnership(user, role, allSolicitudes, users);

  const now = new Date();
  const inMonth = (d: string) => {
    const dt = new Date(d);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  };

  const kpis = {
    pendientes: solicitudes.filter((s) => s.jefe_status === "Pendiente").length,
    autorizados: solicitudes.filter((s) => s.estatus === "Cerrado" && inMonth(s.created_at)).length,
    atrasados: solicitudes.filter((s) => s.estatus === "Cerrado" && s.comprobante_viaje && (Date.now() - new Date(s.created_at).getTime()) / 86400000 > 7).length,
    enTiempo: solicitudes.filter((s) => s.estatus === "Cerrado" && s.comprobante_viaje).length,
    porComprobar: solicitudes.filter((s) => s.estatus === "Cerrado" && !s.comprobante_viaje).length,
  };

  // chart data: group by month
  const byMonth: Record<string, number> = {};
  for (const s of solicitudes) {
    const d = new Date(s.created_at);
    const k = d.toLocaleString("es-MX", { month: "short" });
    byMonth[k] = (byMonth[k] || 0) + s.monto_total;
  }
  const chart = Object.entries(byMonth).map(([m, v]) => ({ mes: m, total: v }));

  const recientes = [...solicitudes].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const userName = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi icon={Clock} label="Pendientes por autorizar" value={kpis.pendientes} color="#B45309" bg="#FEF3C7" hint="Requiere acción" />
        <Kpi icon={CheckCircle2} label="Autorizados del mes" value={kpis.autorizados} color="#2D6A4F" bg="#D8F3DC" hint="↑ este mes" />
        <Kpi icon={AlertTriangle} label="Comprobación atrasada +7d" value={kpis.atrasados} color="#E30613" bg="#FEE9EA" hint="Crítico" />
        <Kpi icon={ClockArrowDown} label="Comprobación en tiempo" value={kpis.enTiempo} color="#FFA500" bg="#FFDBBB" />
        <Kpi icon={FileText} label="Pendientes de comprobar" value={kpis.porComprobar} color="#1D4ED8" bg="#DBEAFE" />
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
            <MonthlyPillChart data={chart} />
          </div>
        </div>
        <div className="ckl-card p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Cédula Fiscal</div>
            <button onClick={() => toast.success("PDF descargado.")} className="ckl-btn-ghost"><Download size={14} /> PDF</button>
          </div>
          {mySoc ? (
            <dl className="mt-3 space-y-2 text-xs">
              <Row k="Razón social" v={mySoc.nombre} />
              <Row k="RFC" v={mySoc.rfc} />
              <Row k="Régimen" v={mySoc.regimen} />
              <Row k="CP" v={mySoc.cp} />
              <Row k="Uso CFDI" v={mySoc.UsoCFDI} />
              <Row k="Sociedad SAP" v={mySoc.sociedad_sap} />
            </dl>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Sin sociedad asignada.</p>
          )}
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <div className="text-sm font-semibold">Solicitudes recientes</div>
          <Link to="/estatus" className="text-xs font-semibold" style={{ color: "var(--color-primary)" }}>Ver todas</Link>
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
                const ok = s.jefe_status === "Autorizado" && (s.finanzas_status === "Autorizado" || s.finanzas_status === "N/A");
                const bad = s.jefe_status === "Rechazado" || s.finanzas_status === "Rechazado";
                const stripe = bad ? "#E30613" : ok ? "#2D6A4F" : "#CCC";
                return (
                  <tr key={s.id} className="border-t" style={{ borderLeft: `3px solid ${stripe}` }}>
                    <td className="p-3 font-mono text-xs">{s.folio}</td>
                    <td className="p-3 text-xs">{s.fecha}</td>
                    <td className="p-3">{userName(s.user_id)}</td>
                    <td className="p-3 text-xs">{s.destino_resumen}</td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(s.monto_total)}</td>
                    <td className="p-3"><StatusBadge estatus={s.estatus} /></td>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

export function StatusBadge({ estatus }: { estatus: string }) {
  const m: Record<string, { bg: string; color: string }> = {
    Cerrado: { bg: "#D8F3DC", color: "#2D6A4F" },
    Abierto: { bg: "#FEF3C7", color: "#B45309" },
    Rechazado: { bg: "#FEE9EA", color: "#E30613" },
    Pendiente: { bg: "#FEF3C7", color: "#B45309" },
    Autorizado: { bg: "#D8F3DC", color: "#2D6A4F" },
    "N/A": { bg: "#F1F3F5", color: "#666" },
  };
  const s = m[estatus] ?? m.Pendiente;
  return <span className="ckl-badge" style={{ background: s.bg, color: s.color }}>{estatus}</span>;
}
