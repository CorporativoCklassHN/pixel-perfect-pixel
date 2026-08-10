import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  KEYS, lsGet, lsSet, fmtMoney, nextFolio, uid,
  type Hotel, type Solicitud, type ComprobanteGasto,
} from "@/lib/store";

export const Route = createFileRoute("/_portal/solicitar")({
  head: () => ({ meta: [{ title: "Solicitar viáticos — CKL" }] }),
  component: Solicitar,
});

const ESTADOS = ["Jalisco", "CDMX", "Guanajuato", "Nuevo León", "Querétaro", "Colima", "Zacatecas"];
const TIPOS = ["Comercial", "Auditoría", "Visita a tiendas", "Capacitación", "Expos", "Visita a proveedores", "Otros"];
const MEDIOS_FORANEO = ["Avión", "Camión", "Tren", "Barco", "Otro"];
const MEDIOS_LOCAL = ["Uber", "Taxi", "Metro", "Combi", "Otro"];

type Row = { id: string; tipo: string; monto: number };
type OtroRow = { id: string; concepto: string; monto: number };

type Destino = {
  id: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  hotel_monto: number;
  hotel_manual: boolean;
  foraneo: Row[];
  local: Row[];
  otros: OtroRow[];
};

function newDestino(): Destino {
  return {
    id: uid("d_"), estado: "Jalisco",
    fecha_inicio: "", fecha_fin: "",
    hotel_monto: 0, hotel_manual: false,
    foraneo: [], local: [], otros: [],
  };
}

function daysBetween(a: string, b: string) {
  if (!a || !b) return 0;
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.floor((d2.getTime() - d1.getTime()) / 86400000) + 1);
}

// Noches de hotel = días del rango - 1 (entrada y salida el mismo día no genera noche).
function nightsBetween(a: string, b: string) {
  return Math.max(0, daysBetween(a, b) - 1);
}

function Solicitar() {
  const { user } = useAuth();
  const nav = useNavigate();
  const origenes = lsGet<string[]>(KEYS.origenes, []);
  const hoteles = lsGet<Hotel[]>(KEYS.hoteles, []);
  const config = lsGet<{ monto_comida_diario: number; umbral_finanzas: number }>(KEYS.config, { monto_comida_diario: 450, umbral_finanzas: 5000 });

  const [folio] = useState(nextFolio());
  const today = new Date().toLocaleDateString("es-MX");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [origen, setOrigen] = useState(origenes[0] ?? "");
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [personas, setPersonas] = useState(1);
  const [nombres, setNombres] = useState(user?.nombre ?? "");
  const [motivo, setMotivo] = useState("");
  const [destinos, setDestinos] = useState<Destino[]>([newDestino()]);
  const [showModal, setShowModal] = useState(false);

  const updateD = (id: string, patch: Partial<Destino>) =>
    setDestinos((arr) => arr.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const totals = useMemo(() => {
    let foraneo = 0, local = 0, otros = 0, hotel = 0, diasTot = 0;
    for (const d of destinos) {
      const tarifa = Number(d.hotel_monto) || 0;
      // Si no es monto manual, hotel_monto es la tarifa por noche: se multiplica por las noches del rango.
      hotel += d.hotel_manual ? tarifa : tarifa * nightsBetween(d.fecha_inicio, d.fecha_fin);
      foraneo += d.foraneo.reduce((a, r) => a + (Number(r.monto) || 0), 0);
      local += d.local.reduce((a, r) => a + (Number(r.monto) || 0), 0);
      otros += d.otros.reduce((a, r) => a + (Number(r.monto) || 0), 0);
      diasTot += daysBetween(d.fecha_inicio, d.fecha_fin);
    }
    const comida = diasTot * config.monto_comida_diario * personas;
    const total = comida + foraneo + local + otros + hotel;
    return { comida, foraneo, local, otros, hotel, total, diasTot };
  }, [destinos, personas, config.monto_comida_diario]);

  const requiresFin = totals.total > config.umbral_finanzas;

  const guardar = () => {
    if (!motivo.trim()) return toast.error("Captura el motivo del viaje.");
    for (let i = 0; i < destinos.length; i++) {
      const d = destinos[i];
      if (!d.fecha_inicio || !d.fecha_fin) return toast.error(`Captura las fechas del destino ${i + 1}.`);
      if (d.fecha_inicio < todayIso) return toast.error(`La fecha de inicio del destino ${i + 1} no puede ser anterior a hoy.`);
      if (d.fecha_fin < d.fecha_inicio) return toast.error(`La fecha fin del destino ${i + 1} no puede ser anterior a su fecha de inicio.`);
      if (i > 0 && d.fecha_inicio < destinos[i - 1].fecha_fin) {
        return toast.error(`Las fechas del destino ${i + 1} se empalman con el destino ${i}.`);
      }
    }
    const resumen = destinos.map((d) => d.estado).join(" - ");
    const sol: Solicitud = {
      id: uid("s_"), folio, user_id: user!.id, fecha: today,
      empresa: user!.empresa, origen,
      destino_resumen: `${origen} - ${resumen}`,
      tipo_viaje: tipo, motivo,
      personas_count: personas, personas_nombres: nombres,
      monto_total: totals.total,
      jefe_status: "Pendiente",
      finanzas_status: requiresFin ? "Pendiente" : "N/A",
      estatus: "Abierto", comprobante_viaje: null,
      created_at: new Date().toISOString().slice(0, 10),
    };
    const list = lsGet<Solicitud[]>(KEYS.solicitudes, []);
    lsSet(KEYS.solicitudes, [sol, ...list]);

    const dList = lsGet<any[]>(KEYS.destinos, []);
    lsSet(KEYS.destinos, [...dList, ...destinos.map((d) => ({ ...d, solicitud_id: sol.id }))]);

    const cg = lsGet<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
    const newCg: ComprobanteGasto[] = [
      { id: uid("cg_"), solicitud_id: sol.id, concepto: "Hotel", monto_solicitado: totals.hotel, monto_comprobado: 0, status_renglon: "pendiente" },
      { id: uid("cg_"), solicitud_id: sol.id, concepto: "Transporte foráneo", monto_solicitado: totals.foraneo, monto_comprobado: 0, status_renglon: "pendiente" },
      { id: uid("cg_"), solicitud_id: sol.id, concepto: "Transporte local", monto_solicitado: totals.local, monto_comprobado: 0, status_renglon: "pendiente" },
      { id: uid("cg_"), solicitud_id: sol.id, concepto: "Comida", monto_solicitado: totals.comida, monto_comprobado: 0, status_renglon: "pendiente" },
      { id: uid("cg_"), solicitud_id: sol.id, concepto: "Otros", monto_solicitado: totals.otros, monto_comprobado: 0, status_renglon: "pendiente" },
    ];
    lsSet(KEYS.comprobantesGasto, [...cg, ...newCg]);

    toast.success(`Solicitud ${folio} registrada.`);
    setShowModal(true);
  };

  const esMartes = new Date().getDay() === 2;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24">
      {!esMartes && (
        <div
          className="flex items-center gap-2 rounded-md border px-4 py-3 text-sm"
          style={{
            background: "var(--color-warning-soft)",
            color: "var(--color-warning)",
            borderColor: "var(--color-warning)",
          }}
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            <b>Hoy no es martes.</b> Recuerda que las solicitudes preferentemente se capturan los
            martes.
          </span>
        </div>
      )}

      {/* General */}
      <section className="ckl-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Datos generales</h2>
          <span className="ckl-badge" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>Folio {folio}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Fecha"><input className="ckl-input" value={today} readOnly /></Field>
          <Field label="Empresa"><input className="ckl-input" value={user?.empresa ?? ""} readOnly /></Field>
          <Field label="Origen">
            <select className="ckl-input" value={origen} onChange={(e) => setOrigen(e.target.value)}>
              {origenes.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Tipo de viaje">
            <select className="ckl-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="No. de personas">
            <input type="number" min={1} className="ckl-input" value={personas} onChange={(e) => setPersonas(Math.max(1, +e.target.value))} />
          </Field>
          <Field label="Nombres de viajeros">
            <input className="ckl-input" value={nombres} onChange={(e) => setNombres(e.target.value)} />
          </Field>
          <Field label="Motivo" className="md:col-span-3">
            <textarea className="ckl-input min-h-[72px]" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Describe el objetivo del viaje..." />
          </Field>
        </div>
      </section>

      {/* Destinos */}
      <section className="ckl-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Destinos y desglose</h2>
          <button onClick={() => setDestinos((d) => [...d, newDestino()])} className="ckl-btn-outline">
            <Plus size={14} /> Agregar destino
          </button>
        </div>
        <div className="space-y-4">
          {destinos.map((d, idx) => (
            <DestinoBlock
              key={d.id} idx={idx} d={d} hoteles={hoteles}
              minStart={idx === 0 ? todayIso : destinos[idx - 1].fecha_fin || todayIso}
              onChange={(p) => updateD(d.id, p)}
              onRemove={destinos.length > 1 ? () => setDestinos((arr) => arr.filter((x) => x.id !== d.id)) : undefined}
            />
          ))}
        </div>
      </section>

      {/* Totals bar */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-white p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] md:-mx-6">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 md:grid-cols-6">
          <Tot label="Comida" v={totals.comida} />
          <Tot label="Trans. foráneo" v={totals.foraneo} />
          <Tot label="Trans. local" v={totals.local} />
          <Tot label="Otros" v={totals.otros} />
          <Tot label="Hotel" v={totals.hotel} />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total a depositar</div>
            <div className="text-xl font-bold" style={{ color: "var(--color-primary)" }}>{fmtMoney(totals.total)}</div>
          </div>
        </div>
        <div className="mx-auto mt-3 flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <span className="ckl-badge" style={{ background: requiresFin ? "#FEF3C7" : "#DCFCE7", color: requiresFin ? "#D97706" : "#16A34A" }}>
            {requiresFin ? "Requiere aprobación: Jefe Inmediato + Finanzas" : "Requiere aprobación: Jefe Inmediato"}
          </span>
          <div className="flex gap-2">
            <button onClick={() => nav({ to: "/estatus" })} className="ckl-btn-outline">Cancelar</button>
            <button onClick={guardar} className="ckl-btn-primary">Guardar solicitud</button>
          </div>
        </div>
      </div>

      {showModal && (
        <Modal>
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "#D8F3DC", color: "#2D6A4F" }}>
              <CheckCircle2 size={32} />
            </div>
            <h3 className="mt-4 text-lg font-semibold">¡Solicitud registrada!</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Sus viáticos se depositarán el siguiente viernes después de su solicitud, una vez autorizados.
            </p>
            <button onClick={() => nav({ to: "/estatus" })} className="ckl-btn-primary mt-5">Ver mis solicitudes</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: any) {
  return (
    <div className={className}>
      <label className="ckl-label">{label}</label>
      {children}
    </div>
  );
}

function Tot({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{fmtMoney(v)}</div>
    </div>
  );
}

function DestinoBlock({
  idx,
  d,
  hoteles,
  minStart,
  onChange,
  onRemove,
}: {
  idx: number;
  d: Destino;
  hoteles: Hotel[];
  minStart: string;
  onChange: (p: Partial<Destino>) => void;
  onRemove?: () => void;
}) {
  const filteredHotels = hoteles.filter((h) => h.estado === d.estado && h.activo);
  const days = daysBetween(d.fecha_inicio, d.fecha_fin);
  const nights = nightsBetween(d.fecha_inicio, d.fecha_fin);
  const dayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  // Active day indexes within Mon-Sun grid (use start day-of-week)
  const activeIdx = new Set<number>();
  if (d.fecha_inicio && days > 0) {
    const start = new Date(d.fecha_inicio);
    let dow = (start.getDay() + 6) % 7; // Mon=0
    for (let i = 0; i < days && dow < 7; i++, dow++) activeIdx.add(dow);
  }

  return (
    <div className="rounded-[10px] border bg-secondary p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="ckl-badge" style={{ background: "var(--color-primary)", color: "white" }}>Destino {idx + 1}</span>
        <select className="ckl-input max-w-[180px]" value={d.estado} onChange={(e) => onChange({ estado: e.target.value, hotel_monto: 0 })}>
          {ESTADOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input
          type="date"
          className="ckl-input max-w-[150px]"
          value={d.fecha_inicio}
          min={minStart}
          onChange={(e) => {
            const v = e.target.value;
            if (v && v < minStart) {
              toast.error(
                idx === 0
                  ? "La fecha de inicio no puede ser anterior a hoy."
                  : `La fecha de inicio no puede ser anterior a la fecha fin del destino ${idx}.`,
              );
              return;
            }
            const patch: Partial<Destino> = { fecha_inicio: v };
            if (d.fecha_fin && v && d.fecha_fin < v) patch.fecha_fin = "";
            onChange(patch);
          }}
        />
        <input
          type="date"
          className="ckl-input max-w-[150px]"
          value={d.fecha_fin}
          min={d.fecha_inicio || minStart}
          onChange={(e) => {
            const v = e.target.value;
            if (v && d.fecha_inicio && v < d.fecha_inicio) {
              toast.error("La fecha fin no puede ser anterior a la fecha de inicio.");
              return;
            }
            onChange({ fecha_fin: v });
          }}
        />
        <span className="text-xs text-muted-foreground">{days} día(s)</span>
        {onRemove && (
          <button onClick={onRemove} className="ml-auto rounded p-1.5 text-muted-foreground hover:text-foreground"><X size={16} /></button>
        )}
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {dayLabels.map((lbl, i) => {
          const active = activeIdx.has(i);
          return (
            <div key={i} className="rounded-md border bg-white p-2 text-center" style={{ opacity: active ? 1 : 0.5, background: active ? "white" : "#F1F3F5" }}>
              <div className="text-[10px] font-semibold text-muted-foreground">{lbl}</div>
              <div className="mt-1.5 flex flex-col gap-1">
                {["Hotel", "Transporte", "Otros"].map((t) => {
                  const has = active && ((t === "Hotel" && d.hotel_monto) || (t === "Transporte" && (d.foraneo.length || d.local.length)) || (t === "Otros" && d.otros.length));
                  return (
                    <div key={t} className="rounded px-1 py-0.5 text-[10px] font-bold" style={{ background: has ? "#FEE9EA" : "transparent", color: has ? "#B5040F" : "#333333" }}>
                      {t}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hotel */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="ckl-label">Hotel:</label>
          {!d.hotel_manual ? (
            <select className="ckl-input" value={d.hotel_monto} onChange={(e) => onChange({ hotel_monto: +e.target.value })}>
              <option value={0}>— Seleccionar —</option>
              {filteredHotels.map((h) => (
                <option key={h.id} value={h.tarifa_base}>{h.nombre} — {fmtMoney(h.tarifa_base)}</option>
              ))}
            </select>
          ) : (
            <input type="number" className="ckl-input" value={d.hotel_monto} onChange={(e) => onChange({ hotel_monto: +e.target.value })} placeholder="Monto manual" />
          )}
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={d.hotel_manual} onChange={(e) => onChange({ hotel_manual: e.target.checked, hotel_monto: 0 })} />
            Monto manual
          </label>
          {!d.hotel_manual && d.hotel_monto > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {nights} noche(s) × {fmtMoney(d.hotel_monto)} = <b>{fmtMoney(nights * d.hotel_monto)}</b>
            </p>
          )}
        </div>
      </div>

      <RowsSection title="Transporte foráneo" medios={MEDIOS_FORANEO} rows={d.foraneo} onChange={(rs) => onChange({ foraneo: rs })} />
      <RowsSection title="Transporte local" medios={MEDIOS_LOCAL} rows={d.local} onChange={(rs) => onChange({ local: rs })} />
      <OtrosSection rows={d.otros} onChange={(rs) => onChange({ otros: rs })} />
    </div>
  );
}

function RowsSection({ title, medios, rows, onChange }: { title: string; medios: string[]; rows: Row[]; onChange: (r: Row[]) => void }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-[11px] text-muted-foreground">(Poner el monto total del viático)</span>
        </div>
        <button onClick={() => onChange([...rows, { id: uid("r_"), tipo: medios[0], monto: 0 }])} className="ckl-btn-ghost"><Plus size={12} /> Agregar</button>
      </div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Sin entradas.</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex gap-2">
            <select className="ckl-input max-w-[160px]" value={r.tipo} onChange={(e) => onChange(rows.map((x) => x.id === r.id ? { ...x, tipo: e.target.value } : x))}>
              {medios.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input type="number" placeholder="Monto" className="ckl-input" value={r.monto} onChange={(e) => onChange(rows.map((x) => x.id === r.id ? { ...x, monto: +e.target.value } : x))} />
            <button onClick={() => onChange(rows.filter((x) => x.id !== r.id))} className="ckl-btn-ghost"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function OtrosSection({ rows, onChange }: { rows: OtroRow[]; onChange: (r: OtroRow[]) => void }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Otros conceptos</span>
          <span className="text-[11px] text-muted-foreground">(Poner el monto total del viático)</span>
        </div>
        <button onClick={() => onChange([...rows, { id: uid("o_"), concepto: "", monto: 0 }])} className="ckl-btn-ghost"><Plus size={12} /> Agregar</button>
      </div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Sin entradas.</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex gap-2">
            <input placeholder="Concepto" className="ckl-input" value={r.concepto} onChange={(e) => onChange(rows.map((x) => x.id === r.id ? { ...x, concepto: e.target.value } : x))} />
            <input type="number" placeholder="Monto" className="ckl-input max-w-[160px]" value={r.monto} onChange={(e) => onChange(rows.map((x) => x.id === r.id ? { ...x, monto: +e.target.value } : x))} />
            <button onClick={() => onChange(rows.filter((x) => x.id !== r.id))} className="ckl-btn-ghost"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="ckl-card relative w-full max-w-md p-6">
        {onClose && (
          <button onClick={onClose} className="absolute right-3 top-3 rounded p-1 hover:bg-secondary"><X size={16} /></button>
        )}
        {children}
      </div>
    </div>
  );
}
