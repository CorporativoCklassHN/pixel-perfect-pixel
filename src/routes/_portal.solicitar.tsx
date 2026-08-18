import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, X, CheckCircle2, AlertTriangle, Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  KEYS, lsGet, lsSet, fmtMoney, nextFolio, uid,
  type Hotel, type Solicitud, type ComprobanteGasto, type Autorizacion,
} from "@/lib/store";

export const Route = createFileRoute("/_portal/solicitar")({
  validateSearch: (search: Record<string, unknown>): { editId?: string } => {
    const editId = typeof search.editId === "string" ? search.editId : undefined;
    return editId ? { editId } : {};
  },
  head: () => ({ meta: [{ title: "Solicitar viáticos — CKL" }] }),
  component: Solicitar,
});

const ESTADOS = ["Jalisco", "CDMX", "Guanajuato", "Nuevo León", "Querétaro", "Colima", "Zacatecas"];
const TIPOS = ["Comercial", "Auditoría", "Visita a tiendas", "Capacitación", "Expos", "Visita a proveedores", "Otros"];
const MEDIOS_FORANEO = ["Avión", "Autobús", "Tren", "Barco", "Otro"];
const MEDIOS_LOCAL = ["Uber", "Taxi", "Metro", "Combi", "Otro"];

type Row = { id: string; tipo: string; monto: number };
type OtroRow = { id: string; concepto: string; monto: number };

// Una estancia de hotel dentro de un destino. Puede haber varias si el
// viajero cambia de hotel a mitad del destino.
type HotelStay = {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
  monto: number;
  manual: boolean;
};

type Destino = {
  id: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  hoteles: HotelStay[];
  foraneo: Row[];
  local: Row[];
  otros: OtroRow[];
};

function newHotelStay(fecha_inicio = ""): HotelStay {
  return { id: uid("h_"), fecha_inicio, fecha_fin: "", monto: 0, manual: false };
}

function newDestino(): Destino {
  return {
    id: uid("d_"), estado: "Jalisco",
    fecha_inicio: "", fecha_fin: "",
    hoteles: [newHotelStay()],
    foraneo: [], local: [], otros: [],
  };
}

// Reconstruye un Destino guardado en KEYS.destinos, tolerando el esquema
// anterior (hotel_monto/hotel_manual de un solo hotel) para poder editar
// solicitudes creadas antes de que existiera el arreglo `hoteles`.
function normalizeDestino(raw: any): Destino {
  const hoteles: HotelStay[] =
    Array.isArray(raw.hoteles) && raw.hoteles.length
      ? raw.hoteles
      : [
          {
            id: uid("h_"),
            fecha_inicio: raw.fecha_inicio ?? "",
            fecha_fin: raw.fecha_fin ?? "",
            monto: raw.hotel_monto ?? 0,
            manual: raw.hotel_manual ?? false,
          },
        ];
  return {
    id: raw.id ?? uid("d_"),
    estado: raw.estado ?? "Jalisco",
    fecha_inicio: raw.fecha_inicio ?? "",
    fecha_fin: raw.fecha_fin ?? "",
    hoteles,
    foraneo: raw.foraneo ?? [],
    local: raw.local ?? [],
    otros: raw.otros ?? [],
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
  const { editId } = Route.useSearch();
  const origenes = lsGet<string[]>(KEYS.origenes, []);
  const hoteles = lsGet<Hotel[]>(KEYS.hoteles, []);
  const config = lsGet<{ monto_comida_diario: number; umbral_finanzas: number }>(KEYS.config, { monto_comida_diario: 450, umbral_finanzas: 5000 });

  // Solo se puede editar la propia solicitud mientras esté Abierta y sin
  // ninguna autorización/rechazo registrado — mismo criterio que "canEdit" en Estatus.
  const editing = useMemo(() => {
    if (!editId) return null;
    const found = lsGet<Solicitud[]>(KEYS.solicitudes, []).find((s) => s.id === editId);
    if (!found) return null;
    const autorizaciones = lsGet<Autorizacion[]>(KEYS.autorizaciones, []);
    const puedeEditar =
      found.user_id === user?.id &&
      found.estatus === "Abierto" &&
      !autorizaciones.some((a) => a.solicitud_id === found.id);
    return puedeEditar ? found : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, user]);

  useEffect(() => {
    if (editId && !editing) {
      showErrorDialog("Esa solicitud ya no se puede editar.");
      nav({ to: "/estatus" });
    }
  }, [editId, editing, nav]);

  const [folio] = useState(() => editing?.folio ?? nextFolio());
  const today = new Date().toLocaleDateString("es-MX");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [origen, setOrigen] = useState(() => editing?.origen ?? origenes[0] ?? "");
  const [tipo, setTipo] = useState(() => editing?.tipo_viaje ?? TIPOS[0]);
  const [personas, setPersonas] = useState(() => editing?.personas_count ?? 1);
  const [nombres, setNombres] = useState(() => editing?.personas_nombres ?? user?.nombre ?? "");
  const [motivo, setMotivo] = useState(() => editing?.motivo ?? "");
  const [destinos, setDestinos] = useState<Destino[]>(() => {
    if (!editing) return [newDestino()];
    const stored = lsGet<any[]>(KEYS.destinos, []).filter((d) => d.solicitud_id === editing.id);
    return stored.length ? stored.map(normalizeDestino) : [newDestino()];
  });
  const [showModal, setShowModal] = useState(false);

  const updateD = (id: string, patch: Partial<Destino>) =>
    setDestinos((arr) => arr.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const totals = useMemo(() => {
    let foraneo = 0, local = 0, otros = 0, hotel = 0, diasTot = 0;
    for (const d of destinos) {
      for (const h of d.hoteles) {
        const tarifa = Number(h.monto) || 0;
        // Si no es monto manual, monto es la tarifa por noche: se multiplica por las noches de esa estancia.
        hotel += h.manual ? tarifa : tarifa * nightsBetween(h.fecha_inicio, h.fecha_fin);
      }
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
    if (!motivo.trim()) return showErrorDialog("Captura el motivo del viaje.");
    for (let i = 0; i < destinos.length; i++) {
      const d = destinos[i];
      if (!d.fecha_inicio || !d.fecha_fin) return showErrorDialog(`Captura las fechas del destino ${i + 1}.`);
      if (d.fecha_inicio < todayIso) {
        return showErrorDialog(`La fecha de inicio del destino ${i + 1} no puede ser anterior a hoy.`);
      }
      if (d.fecha_fin < d.fecha_inicio) {
        return showErrorDialog(
          `La fecha fin del destino ${i + 1} no puede ser anterior a su fecha de inicio.`,
        );
      }
      if (i > 0 && d.fecha_inicio < destinos[i - 1].fecha_fin) {
        return showErrorDialog(`Las fechas del destino ${i + 1} se empalman con el destino ${i}.`);
      }
      for (let hi = 0; hi < d.hoteles.length; hi++) {
        const h = d.hoteles[hi];
        if (!h.monto) continue;
        if (!h.fecha_inicio || !h.fecha_fin) {
          return showErrorDialog(`Captura las fechas del hotel ${hi + 1} en el destino ${i + 1}.`);
        }
        if (h.fecha_fin < h.fecha_inicio) {
          return showErrorDialog(`El check-out del hotel ${hi + 1} (destino ${i + 1}) no puede ser anterior al check-in.`);
        }
        if (hi > 0 && h.fecha_inicio < d.hoteles[hi - 1].fecha_fin) {
          return showErrorDialog(`Las fechas del hotel ${hi + 1} se empalman con el hotel ${hi} (destino ${i + 1}).`);
        }
      }
      // Si se está cobrando hotel en este destino, las estancias deben cubrir
      // exactamente todo el rango del destino, sin huecos entre ellas.
      const usedIdx = d.hoteles.map((h, idx) => (h.monto > 0 ? idx : -1)).filter((idx) => idx !== -1);
      if (usedIdx.length > 0) {
        const fmtFecha = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");
        const first = usedIdx[0];
        const last = usedIdx[usedIdx.length - 1];
        // Un hotel sin seleccionar entre dos que sí tienen monto es casi
        // seguro un olvido del usuario, no un renglón sobrante al final.
        for (let hi = first; hi <= last; hi++) {
          if (!(d.hoteles[hi].monto > 0)) {
            return showErrorDialog(
              `Falta seleccionar el hotel de la estancia ${hi + 1} en el destino ${i + 1} (o elimínala si no aplica).`,
            );
          }
        }
        const hotelesUsados = d.hoteles.slice(first, last + 1);
        if (hotelesUsados[0].fecha_inicio !== d.fecha_inicio) {
          return showErrorDialog(
            `El primer hotel del destino ${i + 1} debe iniciar el ${fmtFecha(d.fecha_inicio)} (inicio del destino).`,
          );
        }
        for (let k = 1; k < hotelesUsados.length; k++) {
          if (hotelesUsados[k].fecha_inicio !== hotelesUsados[k - 1].fecha_fin) {
            return showErrorDialog(
              `Hay un hueco entre las fechas de los hoteles del destino ${i + 1}. Cúbrelo o ajusta las fechas.`,
            );
          }
        }
        const ultimoHotel = hotelesUsados[hotelesUsados.length - 1];
        if (ultimoHotel.fecha_fin !== d.fecha_fin) {
          return showErrorDialog(
            `El último hotel del destino ${i + 1} debe terminar el ${fmtFecha(d.fecha_fin)} (fin del destino).`,
          );
        }
      }
    }
    const resumen = destinos.map((d) => d.estado).join(" - ");
    const solId = editing?.id ?? uid("s_");

    const sol: Solicitud = editing
      ? {
          ...editing,
          origen,
          destino_resumen: `${origen} - ${resumen}`,
          tipo_viaje: tipo, motivo,
          personas_count: personas, personas_nombres: nombres,
          monto_total: totals.total,
          finanzas_status: requiresFin ? "Pendiente" : "N/A",
        }
      : {
          id: solId, folio, user_id: user!.id, fecha: today,
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
    lsSet(KEYS.solicitudes, editing ? list.map((s) => (s.id === solId ? sol : s)) : [sol, ...list]);

    const dList = lsGet<any[]>(KEYS.destinos, []).filter((d) => d.solicitud_id !== solId);
    lsSet(KEYS.destinos, [...dList, ...destinos.map((d) => ({ ...d, solicitud_id: solId }))]);

    const cg = lsGet<ComprobanteGasto[]>(KEYS.comprobantesGasto, []).filter(
      (c) => c.solicitud_id !== solId,
    );
    const newCg: ComprobanteGasto[] = [
      {
        id: uid("cg_"),
        solicitud_id: solId,
        concepto: "Hotel",
        monto_solicitado: totals.hotel,
        monto_comprobado: 0,
        status_renglon: "pendiente",
      },
      {
        id: uid("cg_"),
        solicitud_id: solId,
        concepto: "Transporte foráneo",
        monto_solicitado: totals.foraneo,
        monto_comprobado: 0,
        status_renglon: "pendiente",
      },
      {
        id: uid("cg_"),
        solicitud_id: solId,
        concepto: "Transporte local",
        monto_solicitado: totals.local,
        monto_comprobado: 0,
        status_renglon: "pendiente",
      },
      {
        id: uid("cg_"),
        solicitud_id: solId,
        concepto: "Comida",
        monto_solicitado: totals.comida,
        monto_comprobado: 0,
        status_renglon: "pendiente",
      },
      {
        id: uid("cg_"),
        solicitud_id: solId,
        concepto: "Otros",
        monto_solicitado: totals.otros,
        monto_comprobado: 0,
        status_renglon: "pendiente",
      },
    ];
    lsSet(KEYS.comprobantesGasto, [...cg, ...newCg]);

    toast.success(editing ? `Solicitud ${folio} actualizada.` : `Solicitud ${folio} registrada.`);
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
          <h2 className="text-base font-semibold">
            {editing ? "Editar solicitud" : "Datos generales"}
          </h2>
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
            <button onClick={guardar} className="ckl-btn-primary">
              {editing ? "Guardar cambios" : "Guardar solicitud"}
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <Modal>
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "#D8F3DC", color: "#2D6A4F" }}>
              <CheckCircle2 size={32} />
            </div>
            <h3 className="mt-4 text-lg font-semibold">
              {editing ? "¡Solicitud actualizada!" : "¡Solicitud registrada!"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {editing
                ? "Los cambios se guardaron correctamente."
                : "Sus viáticos se depositarán el siguiente viernes después de su solicitud, una vez autorizados."}
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

// Selector de fecha propio: siempre se muestra/edita en dd/mm/aaaa sin importar
// el navegador (los <input type="date"> nativos usan el formato/locale del
// navegador — en Safari puede no ser dd/mm/aaaa). value/onChange usan el mismo
// formato ISO (yyyy-mm-dd) que ya maneja el resto de las validaciones.
function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  const minDate = min ? parseISO(min) : undefined;
  const maxDate = max ? parseISO(max) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`ckl-input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
          <span className={selected && isValid(selected) ? "" : "text-muted-foreground"}>
            {selected && isValid(selected) ? format(selected, "dd/MM/yyyy") : "dd/mm/aaaa"}
          </span>
          <CalendarIcon size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          selected={selected}
          defaultMonth={selected ?? minDate ?? maxDate}
          onSelect={(d) => {
            if (!d) return;
            onChange(format(d, "yyyy-MM-dd"));
            setOpen(false);
          }}
          disabled={(d) => (minDate ? d < minDate : false) || (maxDate ? d > maxDate : false)}
        />
      </PopoverContent>
    </Popover>
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

  const updateHotel = (hid: string, patch: Partial<HotelStay>) =>
    onChange({ hoteles: d.hoteles.map((h) => (h.id === hid ? { ...h, ...patch } : h)) });

  const addHotel = () => {
    const last = d.hoteles[d.hoteles.length - 1];
    onChange({ hoteles: [...d.hoteles, newHotelStay(last?.fecha_fin || d.fecha_inicio)] });
  };

  const removeHotel = (hid: string) => onChange({ hoteles: d.hoteles.filter((h) => h.id !== hid) });

  return (
    <div className="rounded-[10px] border bg-secondary p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="ckl-badge" style={{ background: "var(--color-primary)", color: "white" }}>Destino {idx + 1}</span>
        <select
          className="ckl-input max-w-[180px]"
          value={d.estado}
          onChange={(e) =>
            onChange({ estado: e.target.value, hoteles: d.hoteles.map((h) => ({ ...h, monto: 0 })) })
          }
        >
          {ESTADOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <DateField
          className="max-w-[150px]"
          value={d.fecha_inicio}
          min={minStart}
          onChange={(v) => {
            if (v < minStart) {
              showErrorDialog(
                idx === 0
                  ? "La fecha de inicio no puede ser anterior a hoy."
                  : `La fecha de inicio no puede ser anterior a la fecha fin del destino ${idx}.`,
              );
              return;
            }
            const patch: Partial<Destino> = { fecha_inicio: v };
            if (d.fecha_fin && d.fecha_fin < v) patch.fecha_fin = "";
            onChange(patch);
          }}
        />
        <DateField
          className="max-w-[150px]"
          value={d.fecha_fin}
          min={d.fecha_inicio || minStart}
          onChange={(v) => {
            if (d.fecha_inicio && v < d.fecha_inicio) {
              showErrorDialog("La fecha fin no puede ser anterior a la fecha de inicio.");
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

      {/* Hoteles */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Hoteles</span>
          <button onClick={addHotel} className="ckl-btn-ghost"><Plus size={12} /> Agregar Hotel</button>
        </div>
        {(!d.fecha_inicio || !d.fecha_fin) && (
          <p className="mb-2 text-[11px]" style={{ color: "var(--color-warning)" }}>
            Selecciona primero las fechas del destino para habilitar las fechas de hotel.
          </p>
        )}
        <div className="space-y-3">
          {d.hoteles.map((h, hi) => {
            const hMin = hi === 0 ? d.fecha_inicio : d.hoteles[hi - 1].fecha_fin || d.fecha_inicio;
            const hNights = nightsBetween(h.fecha_inicio, h.fecha_fin);
            return (
              <div key={h.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Hotel:</span>
                  <div className="min-w-[200px] flex-1">
                    {!h.manual ? (
                      <select
                        className="ckl-input"
                        value={h.monto}
                        onChange={(e) => updateHotel(h.id, { monto: +e.target.value })}
                      >
                        <option value={0}>— Seleccionar —</option>
                        {filteredHotels.map((ho) => (
                          <option key={ho.id} value={ho.tarifa_base}>{ho.nombre} — {fmtMoney(ho.tarifa_base)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        className="ckl-input"
                        value={h.monto}
                        onChange={(e) => updateHotel(h.id, { monto: +e.target.value })}
                        placeholder="Monto manual"
                      />
                    )}
                  </div>
                  <DateField
                    className="max-w-[150px]"
                    value={h.fecha_inicio}
                    min={hMin}
                    max={d.fecha_fin}
                    disabled={!d.fecha_inicio || !d.fecha_fin}
                    onChange={(v) => {
                      if (hMin && v < hMin) {
                        showErrorDialog(
                          hi === 0
                            ? "El check-in no puede ser anterior al inicio del destino."
                            : `El check-in no puede ser anterior al check-out del hotel ${hi}.`,
                        );
                        return;
                      }
                      const patch: Partial<HotelStay> = { fecha_inicio: v };
                      if (h.fecha_fin && h.fecha_fin < v) patch.fecha_fin = "";
                      updateHotel(h.id, patch);
                    }}
                  />
                  <DateField
                    className="max-w-[150px]"
                    value={h.fecha_fin}
                    min={h.fecha_inicio || hMin}
                    max={d.fecha_fin}
                    disabled={!d.fecha_inicio || !d.fecha_fin}
                    onChange={(v) => {
                      if (h.fecha_inicio && v < h.fecha_inicio) {
                        showErrorDialog("El check-out no puede ser anterior al check-in.");
                        return;
                      }
                      updateHotel(h.id, { fecha_fin: v });
                    }}
                  />
                  {d.hoteles.length > 1 && (
                    <button
                      onClick={() => removeHotel(h.id)}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={h.manual}
                    onChange={(e) => updateHotel(h.id, { manual: e.target.checked, monto: 0 })}
                  />
                  Monto manual
                </label>
                {!h.manual && h.monto > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {hNights} noche(s) × {fmtMoney(h.monto)} = <b>{fmtMoney(hNights * h.monto)}</b>
                  </p>
                )}
              </div>
            );
          })}
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
