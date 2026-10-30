import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useAuth, useLocalStorage } from "@/lib/auth";
import {
  CATEGORIAS_GASTO,
  KEYS,
  fmtMoney,
  renglonesGasto,
  type CategoriaGasto,
  type ComprobanteGasto,
  type RenglonGasto,
  type Sociedad,
  type Solicitud,
  type User,
} from "@/lib/store";

// Un color por concepto, en orden fijo (nunca se reasigna por monto). Paleta categórica
// validada (separación para daltonismo OK); los tres tonos claros llevan etiqueta visible
// con el monto y hay vista de tabla, así que el color nunca es el único canal.
const COLOR_CATEGORIA: Record<CategoriaGasto, string> = {
  Hotel: "#2a78d6",
  "Transporte foráneo": "#eb6834",
  "Transporte local": "#1baf7a",
  Comida: "#eda100",
  Automóvil: "#e87ba4",
  Vales: "#008300",
};

const pct = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0);
const pct1 = (n: number) => `${n.toFixed(1)}%`;

// Renglones de gasto (todas las solicitudes no rechazadas) a partir de los datos guardados.
function useRenglonesGasto(): RenglonGasto[] {
  const [solicitudes] = useLocalStorage<Solicitud[]>(KEYS.solicitudes, []);
  const [comprobantes] = useLocalStorage<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
  const [destinos] = useLocalStorage<{ solicitud_id: string; automovil?: { gasolina?: number } }[]>(
    KEYS.destinos,
    [],
  );
  return useMemo(
    () => renglonesGasto(solicitudes, comprobantes, destinos),
    [solicitudes, comprobantes, destinos],
  );
}

function totalesPorCategoria(rs: RenglonGasto[], base: "solicitado" | "comprobado") {
  const m = new Map<CategoriaGasto, number>(CATEGORIAS_GASTO.map((c) => [c, 0]));
  for (const r of rs) m.set(r.categoria, (m.get(r.categoria) ?? 0) + r[base]);
  return CATEGORIAS_GASTO.map((categoria) => ({ categoria, monto: m.get(categoria) ?? 0 }));
}

// ───────── Gráfica de pastel (dona) ─────────
// Parte-de-un-todo con 6 conceptos fijos. Cada segmento: borde de 2 px del color de la
// superficie, se resalta al pasar el cursor/enfocar (y resalta su fila), y el centro muestra
// el valor del segmento activo (o el total). La tabla de al lado es la vista accesible.
function DonutGasto({
  datos,
  etiquetaTotal = "Total",
}: {
  datos: { categoria: CategoriaGasto; monto: number }[];
  etiquetaTotal?: string;
}) {
  const [activo, setActivo] = useState<CategoriaGasto | null>(null);
  const total = datos.reduce((a, d) => a + d.monto, 0);
  const R = 78;
  const C = 2 * Math.PI * R;
  const GAP = 2;
  const visibles = datos.filter((d) => d.monto > 0);
  let acumulado = 0;

  const seleccionado = datos.find((d) => d.categoria === activo);

  return (
    <div className="grid items-center gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-[220px]">
        <svg
          viewBox="0 0 200 200"
          className="h-auto w-full"
          role="img"
          aria-label={`Gasto por concepto. ${etiquetaTotal}: ${fmtMoney(total)}. ${visibles
            .map((d) => `${d.categoria} ${fmtMoney(d.monto)} (${pct1(pct(d.monto, total))})`)
            .join(", ")}`}
        >
          <circle cx="100" cy="100" r={R} fill="none" stroke="#EEF0F2" strokeWidth="30" />
          {visibles.map((d) => {
            const largo = (d.monto / total) * C;
            const trazo = visibles.length === 1 ? largo : Math.max(0, largo - GAP);
            const inicio = acumulado;
            acumulado += largo;
            const esActivo = activo === d.categoria;
            return (
              <circle
                key={d.categoria}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={COLOR_CATEGORIA[d.categoria]}
                strokeWidth={esActivo ? 36 : 30}
                strokeDasharray={`${trazo} ${C - trazo}`}
                strokeDashoffset={-(inicio + (visibles.length === 1 ? 0 : GAP / 2))}
                transform="rotate(-90 100 100)"
                style={{ cursor: "pointer", transition: "stroke-width 120ms" }}
                tabIndex={0}
                aria-label={`${d.categoria}: ${fmtMoney(d.monto)}, ${pct1(pct(d.monto, total))}`}
                onPointerEnter={() => setActivo(d.categoria)}
                onPointerLeave={() => setActivo(null)}
                onFocus={() => setActivo(d.categoria)}
                onBlur={() => setActivo(null)}
              >
                <title>{`${d.categoria}: ${fmtMoney(d.monto)} (${pct1(pct(d.monto, total))})`}</title>
              </circle>
            );
          })}
          <text x="100" y="92" textAnchor="middle" fontSize="10" fill="#52514e">
            {seleccionado ? seleccionado.categoria : etiquetaTotal}
          </text>
          <text x="100" y="112" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0b0b0b">
            {fmtMoney(seleccionado ? seleccionado.monto : total)}
          </text>
          {seleccionado && (
            <text x="100" y="128" textAnchor="middle" fontSize="10" fill="#52514e">
              {pct1(pct(seleccionado.monto, total))}
            </text>
          )}
        </svg>
      </div>

      {/* Leyenda = vista de tabla: concepto, monto y % (también el respaldo del color) */}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-1 font-medium">Concepto</th>
            <th className="pb-1 text-right font-medium">Monto</th>
            <th className="pb-1 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {datos.map((d) => (
            <tr
              key={d.categoria}
              className="border-t"
              style={{
                background: activo === d.categoria ? "var(--color-secondary)" : undefined,
                opacity: d.monto > 0 ? 1 : 0.5,
              }}
              onPointerEnter={() => setActivo(d.categoria)}
              onPointerLeave={() => setActivo(null)}
            >
              <td className="py-1.5">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-middle"
                  style={{ background: COLOR_CATEGORIA[d.categoria] }}
                />
                {d.categoria}
              </td>
              <td className="py-1.5 text-right font-semibold">{fmtMoney(d.monto)}</td>
              <td className="py-1.5 text-right text-muted-foreground">{pct1(pct(d.monto, total))}</td>
            </tr>
          ))}
          <tr className="border-t-2 font-semibold">
            <td className="py-1.5">{etiquetaTotal}</td>
            <td className="py-1.5 text-right">{fmtMoney(total)}</td>
            <td className="py-1.5 text-right">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ───────── Dashboard ─────────
const PERIODOS = [
  { v: "anio", t: "Año en curso" },
  { v: "3m", t: "Últimos 3 meses" },
  { v: "mes", t: "Este mes" },
  { v: "todo", t: "Todo" },
] as const;

function enPeriodo(iso: string, periodo: string) {
  if (periodo === "todo") return true;
  const f = new Date(iso + "T00:00:00");
  const hoy = new Date();
  if (periodo === "anio") return f.getFullYear() === hoy.getFullYear();
  if (periodo === "mes") return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
  const corte = new Date(hoy);
  corte.setMonth(corte.getMonth() - 3);
  return f >= corte;
}

// Tarjeta del Dashboard (Administrador, Finanzas y Compras): en qué conceptos se gasta más.
export function PanelGastoDashboard() {
  const { hasPerm } = useAuth();
  const renglones = useRenglonesGasto();
  const [periodo, setPeriodo] = useState<string>("anio");
  const datos = useMemo(
    () => totalesPorCategoria(renglones.filter((r) => enPeriodo(r.created_at, periodo)), "solicitado"),
    [renglones, periodo],
  );
  if (!hasPerm("ver_gasto_por_concepto")) return null;
  const total = datos.reduce((a, d) => a + d.monto, 0);
  const mayor = [...datos].sort((a, b) => b.monto - a.monto)[0];

  return (
    <div className="ckl-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Gasto por concepto</div>
          <div className="text-xs text-muted-foreground">
            {total > 0
              ? `Lo que más se gasta: ${mayor.categoria} (${pct1(pct(mayor.monto, total))}). Monto solicitado, sin solicitudes rechazadas.`
              : "Monto solicitado por concepto, sin solicitudes rechazadas."}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="ckl-input !w-auto"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            aria-label="Periodo"
          >
            {PERIODOS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.t}
              </option>
            ))}
          </select>
          <Link
            to="/reportes"
            search={{ vista: "gasto" }}
            className="flex items-center gap-0.5 whitespace-nowrap text-xs font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            Ver reporte <ChevronRight size={14} />
          </Link>
        </div>
      </div>
      {total > 0 ? (
        <DonutGasto datos={datos} />
      ) : (
        <div className="py-8 text-center text-sm text-muted-foreground">Sin gasto en el periodo.</div>
      )}
    </div>
  );
}

// ───────── Reporte: gasto por concepto ─────────
type Agrupacion = "concepto" | "subconcepto" | "usuario" | "usuario_concepto" | "sociedad" | "mes";
const AGRUPACIONES: { v: Agrupacion; t: string; cols: string[] }[] = [
  { v: "concepto", t: "Concepto", cols: ["Concepto"] },
  { v: "subconcepto", t: "Concepto y subconcepto", cols: ["Concepto", "Subconcepto"] },
  { v: "usuario", t: "Usuario", cols: ["Usuario"] },
  { v: "usuario_concepto", t: "Usuario y concepto", cols: ["Usuario", "Concepto"] },
  { v: "sociedad", t: "Sociedad", cols: ["Sociedad"] },
  { v: "mes", t: "Mes", cols: ["Mes"] },
];

export function ReporteGasto() {
  const renglones = useRenglonesGasto();
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [sociedades] = useLocalStorage<Sociedad[]>(KEYS.sociedades, []);
  const [fi, setFi] = useState("");
  const [ff, setFf] = useState("");
  const [soc, setSoc] = useState("Todas");
  const [usuario, setUsuario] = useState("Todos");
  const [cat, setCat] = useState("Todos");
  const [base, setBase] = useState<"solicitado" | "comprobado">("solicitado");
  const [agrupar, setAgrupar] = useState<Agrupacion>("usuario_concepto");

  const nombre = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";
  const usuariosConGasto = useMemo(
    () => [...new Set(renglones.map((r) => r.user_id))].sort((a, b) => nombre(a).localeCompare(nombre(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renglones, users],
  );

  const filtrados = useMemo(
    () =>
      renglones.filter(
        (r) =>
          (!fi || r.created_at >= fi) &&
          (!ff || r.created_at <= ff) &&
          (soc === "Todas" || r.empresa === soc) &&
          (usuario === "Todos" || r.user_id === usuario) &&
          (cat === "Todos" || r.categoria === cat),
      ),
    [renglones, fi, ff, soc, usuario, cat],
  );

  const total = filtrados.reduce((a, r) => a + r[base], 0);
  const solicitudes = new Set(filtrados.map((r) => r.solicitud_id)).size;

  const filas = useMemo(() => {
    const clave = (r: RenglonGasto): string[] => {
      switch (agrupar) {
        case "concepto": return [r.categoria];
        case "subconcepto": return [r.categoria, r.subconcepto];
        case "usuario": return [nombre(r.user_id)];
        case "usuario_concepto": return [nombre(r.user_id), r.categoria];
        case "sociedad": return [r.empresa];
        case "mes": return [r.created_at.slice(0, 7)];
      }
    };
    const m = new Map<string, { claves: string[]; monto: number; sols: Set<string> }>();
    for (const r of filtrados) {
      const k = clave(r);
      const id = k.join("|");
      const g = m.get(id) ?? { claves: k, monto: 0, sols: new Set<string>() };
      g.monto += r[base];
      g.sols.add(r.solicitud_id);
      m.set(id, g);
    }
    const arr = [...m.values()].filter((g) => g.monto > 0);
    // Por mes en orden cronológico; el resto del que más gasta al que menos
    arr.sort((a, b) => (agrupar === "mes" ? a.claves[0].localeCompare(b.claves[0]) : b.monto - a.monto));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, agrupar, base, users]);

  const datosDona = useMemo(() => totalesPorCategoria(filtrados, base), [filtrados, base]);
  const porUsuario = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtrados) m.set(r.user_id, (m.get(r.user_id) ?? 0) + r[base]);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [filtrados, base]);
  const mayorConcepto = [...datosDona].sort((a, b) => b.monto - a.monto)[0];
  const cols = AGRUPACIONES.find((a) => a.v === agrupar)!.cols;

  const exportar = () => {
    const data = filas.map((g, i) => ({
      "#": i + 1,
      ...Object.fromEntries(cols.map((c, k) => [c, g.claves[k]])),
      Solicitudes: g.sols.size,
      Monto: g.monto,
      "% del total": Number(pct(g.monto, total).toFixed(1)),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Gasto por concepto");
    XLSX.writeFile(wb, `gasto_por_concepto_${Date.now()}.xlsx`);
    toast.success("Excel descargado.");
  };

  const tile = (k: string, v: string, sub?: string) => (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="mt-0.5 truncate text-base font-bold">{v}</div>
      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="ckl-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="ckl-label">Fecha inicial</label>
            <input type="date" className="ckl-input" value={fi} onChange={(e) => setFi(e.target.value)} />
          </div>
          <div>
            <label className="ckl-label">Fecha final</label>
            <input type="date" className="ckl-input" value={ff} onChange={(e) => setFf(e.target.value)} />
          </div>
          <div>
            <label className="ckl-label">Sociedad</label>
            <select className="ckl-input" value={soc} onChange={(e) => setSoc(e.target.value)}>
              <option>Todas</option>
              {sociedades.map((s) => (
                <option key={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ckl-label">Usuario</label>
            <select className="ckl-input" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
              <option value="Todos">Todos</option>
              {usuariosConGasto.map((id) => (
                <option key={id} value={id}>
                  {nombre(id)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ckl-label">Concepto</label>
            <select className="ckl-input" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option>Todos</option>
              {CATEGORIAS_GASTO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ckl-label">Monto</label>
            <select
              className="ckl-input"
              value={base}
              onChange={(e) => setBase(e.target.value as "solicitado" | "comprobado")}
            >
              <option value="solicitado">Solicitado</option>
              <option value="comprobado">Comprobado</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="ckl-label">Agrupar por</label>
            <select
              className="ckl-input"
              value={agrupar}
              onChange={(e) => setAgrupar(e.target.value as Agrupacion)}
            >
              {AGRUPACIONES.map((a) => (
                <option key={a.v} value={a.v}>
                  {a.t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Sin solicitudes rechazadas. La gasolina no se comprueba, por eso cuenta igual en solicitado
          y comprobado.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile("Total", fmtMoney(total), base === "solicitado" ? "Solicitado" : "Comprobado")}
        {tile("Solicitudes", String(solicitudes))}
        {tile(
          "Quién gasta más",
          porUsuario ? nombre(porUsuario[0]) : "—",
          porUsuario ? `${fmtMoney(porUsuario[1])} · ${pct1(pct(porUsuario[1], total))}` : undefined,
        )}
        {tile(
          "En qué se gasta más",
          total > 0 ? mayorConcepto.categoria : "—",
          total > 0 ? `${fmtMoney(mayorConcepto.monto)} · ${pct1(pct(mayorConcepto.monto, total))}` : undefined,
        )}
      </div>

      <div className="ckl-card p-5">
        <div className="mb-3 text-sm font-semibold">Gasto por concepto</div>
        {total > 0 ? (
          <DonutGasto datos={datosDona} />
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">Sin resultados con estos filtros.</div>
        )}
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <div className="text-sm font-semibold">
            Detalle por {AGRUPACIONES.find((a) => a.v === agrupar)!.t.toLowerCase()}
          </div>
          <button onClick={exportar} className="ckl-btn-outline" disabled={!filas.length}>
            <FileSpreadsheet size={14} /> Exportar Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">#</th>
                {cols.map((c) => (
                  <th key={c} className="p-3">
                    {c}
                  </th>
                ))}
                <th className="p-3 text-right">Solicitudes</th>
                <th className="p-3 text-right">Monto</th>
                <th className="min-w-[150px] p-3">% del total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((g, i) => (
                <tr key={g.claves.join("|")} className="border-t">
                  <td className="p-3 text-xs text-muted-foreground">{i + 1}</td>
                  {g.claves.map((k, j) => (
                    <td key={j} className="p-3">
                      {cols[j] === "Concepto" && COLOR_CATEGORIA[k as CategoriaGasto] ? (
                        <span>
                          <span
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-middle"
                            style={{ background: COLOR_CATEGORIA[k as CategoriaGasto] }}
                          />
                          {k}
                        </span>
                      ) : (
                        k
                      )}
                    </td>
                  ))}
                  <td className="p-3 text-right">{g.sols.size}</td>
                  <td className="p-3 text-right font-semibold">{fmtMoney(g.monto)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct(g.monto, total)}%`, background: "var(--color-primary)" }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs text-muted-foreground">
                        {pct1(pct(g.monto, total))}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 4} className="p-8 text-center text-xs text-muted-foreground">
                    Sin resultados
                  </td>
                </tr>
              )}
              {filas.length > 0 && (
                <tr className="border-t-2 bg-secondary font-semibold">
                  <td className="p-3" colSpan={cols.length + 1}>
                    Total
                  </td>
                  <td className="p-3 text-right">{solicitudes}</td>
                  <td className="p-3 text-right">{fmtMoney(total)}</td>
                  <td className="p-3">100%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
