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
const MEDIOS_FORANEO = ["Avión", "Autobús", "Tren", "Otro"];
const MEDIOS_LOCAL = ["Uber", "Taxi", "Metro", "Combi", "Otro"];

type Row = { id: string; tipo: string; monto: number };
type OtroRow = { id: string; concepto: string; monto: number };

// Una estancia de hotel dentro de un destino. Puede haber varias si el
// viajero cambia de hotel a mitad del destino. hotel_id identifica el hotel
// del catálogo elegido, independiente de si el monto es manual o no — así al
// activar "Monto manual" no se pierde de vista qué hotel se había elegido.
type HotelStay = {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
  monto: number;
  manual: boolean;
  hotel_id: number;
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
  return { id: uid("h_"), fecha_inicio, fecha_fin: "", monto: 0, manual: false, hotel_id: 0 };
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
      ? raw.hoteles.map((h: any) => ({ ...h, hotel_id: h.hotel_id ?? 0 }))
      : [
          {
            id: uid("h_"),
            fecha_inicio: raw.fecha_inicio ?? "",
            fecha_fin: raw.fecha_fin ?? "",
            monto: raw.hotel_monto ?? 0,
            manual: raw.hotel_manual ?? false,
            hotel_id: 0,
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

  // El folio real solo se asigna al guardar (no al abrir el formulario): si se
  // asignara aquí, dos personas capturando al mismo tiempo verían el mismo
  // número, y si una de las dos no llega a guardar, ese folio se pierde. Se
  // calcula con nextFolio() justo antes de escribir en KEYS.solicitudes, así
  // que refleja lo que exista en ese momento (basado en la hora real de guardado).
  const [folio, setFolio] = useState<string | null>(() => editing?.folio ?? null);
  const today = new Date().toLocaleDateString("es-MX");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [origen, setOrigen] = useState(() => editing?.origen ?? origenes[0] ?? "");
  const [tipo, setTipo] = useState(() => editing?.tipo_viaje ?? TIPOS[0]);
  const [personas, setPersonasCount] = useState(() => editing?.personas_count ?? 1);
  // Un input por viajero (en vez de un solo texto libre) para que capturar
  // varios nombres no dependa de que el usuario use un separador consistente.
  const [nombresArr, setNombresArr] = useState<string[]>(() => {
    const inicial = editing?.personas_nombres ?? user?.nombre ?? "";
    const partes = inicial
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const base = partes.length ? partes : [inicial];
    const count = editing?.personas_count ?? 1;
    return Array.from({ length: count }, (_, i) => base[i] ?? "");
  });
  const setPersonas = (n: number) => {
    const count = Math.max(1, n);
    setPersonasCount(count);
    setNombresArr((arr) => {
      const next = arr.slice(0, count);
      while (next.length < count) next.push("");
      return next;
    });
  };
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
    let foraneo = 0,
      local = 0,
      otros = 0,
      hotel = 0,
      diasTot = 0;
    for (const d of destinos) {
      for (const h of d.hoteles) {
        // El monto (venga del catálogo o sea manual) siempre es la tarifa por
        // noche: se multiplica por las noches de esa estancia.
        const tarifa = Number(h.monto) || 0;
        hotel += tarifa * nightsBetween(h.fecha_inicio, h.fecha_fin);
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
      // Un destino con al menos una noche requiere hotel, se haya tocado o no la
      // sección — y si ya se está cobrando hotel, ninguna estancia puede quedar
      // sin seleccionar (ni al inicio, en medio o al final). En conjunto deben
      // cubrir exactamente todo el rango del destino, sin huecos.
      const requiereHotel = nightsBetween(d.fecha_inicio, d.fecha_fin) > 0;
      const algunHotelUsado = d.hoteles.some((h) => h.monto > 0);
      if (requiereHotel || algunHotelUsado) {
        const fmtFecha = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");
        for (let hi = 0; hi < d.hoteles.length; hi++) {
          if (!(d.hoteles[hi].monto > 0)) {
            return showErrorDialog(
              requiereHotel && !algunHotelUsado
                ? `Selecciona un hotel para el destino ${i + 1} (el viaje incluye noche(s) de hospedaje).`
                : `Falta seleccionar el hotel de la estancia ${hi + 1} en el destino ${i + 1}, o elimina esa fila si no la vas a usar.`,
            );
          }
        }
        if (d.hoteles[0].fecha_inicio !== d.fecha_inicio) {
          return showErrorDialog(
            `El primer hotel del destino ${i + 1} debe iniciar el ${fmtFecha(d.fecha_inicio)} (inicio del destino).`,
          );
        }
        for (let k = 1; k < d.hoteles.length; k++) {
          if (d.hoteles[k].fecha_inicio !== d.hoteles[k - 1].fecha_fin) {
            return showErrorDialog(
              `Hay un hueco entre las fechas de los hoteles del destino ${i + 1}. Cúbrelo o ajusta las fechas.`,
            );
          }
        }
        const ultimoHotel = d.hoteles[d.hoteles.length - 1];
        if (ultimoHotel.fecha_fin !== d.fecha_fin) {
          return showErrorDialog(
            `El último hotel del destino ${i + 1} debe terminar el ${fmtFecha(d.fecha_fin)} (fin del destino).`,
          );
        }
      }
    }
    const resumen = destinos.map((d) => d.estado).join(" - ");
    const solId = editing?.id ?? uid("s_");
    // Se calcula justo aquí, al momento real de guardar (no al abrir el
    // formulario), para que el número refleje lo último persistido en ese
    // instante y no se repita entre dos personas capturando a la vez.
    const folioFinal = editing?.folio ?? nextFolio();
    const nombres = nombresArr.map((n) => n.trim()).filter(Boolean).join(", ");

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
          id: solId, folio: folioFinal, user_id: user!.id, fecha: today,
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
    // Un renglón de comprobación por cada medio de transporte realmente
    // seleccionado (Avión, Autobús, Uber, Taxi...) en vez de un solo
    // "Transporte foráneo"/"Transporte local" genérico — así queda claro qué
    // hay que comprobar. "Otro" se distingue entre foráneo y local porque el
    // mismo nombre puede repetirse en ambas secciones.
    const foraneoPorTipo = new Map<string, number>();
    const localPorTipo = new Map<string, number>();
    for (const d of destinos) {
      for (const r of d.foraneo) {
        const monto = Number(r.monto) || 0;
        if (monto <= 0) continue;
        const concepto = r.tipo === "Otro" ? "Otro (foráneo)" : r.tipo;
        foraneoPorTipo.set(concepto, (foraneoPorTipo.get(concepto) ?? 0) + monto);
      }
      for (const r of d.local) {
        const monto = Number(r.monto) || 0;
        if (monto <= 0) continue;
        const concepto = r.tipo === "Otro" ? "Otro (transporte local)" : r.tipo;
        localPorTipo.set(concepto, (localPorTipo.get(concepto) ?? 0) + monto);
      }
    }
    const transporteCg: ComprobanteGasto[] = [...foraneoPorTipo, ...localPorTipo].map(
      ([concepto, monto]) => ({
        id: uid("cg_"),
        solicitud_id: solId,
        concepto,
        monto_solicitado: monto,
        monto_comprobado: 0,
        status_renglon: "pendiente",
      }),
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
      ...transporteCg,
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

    setFolio(folioFinal);
    toast.success(
      editing ? `Solicitud ${folioFinal} actualizada.` : `Solicitud ${folioFinal} registrada.`,
    );
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
          <span
            className="ckl-badge"
            style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
          >
            {folio ? `Folio ${folio}` : "Folio: se asigna al guardar"}
          </span>
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
            <input
              type="number"
              min={1}
              className="ckl-input"
              value={personas}
              onChange={(e) => setPersonas(+e.target.value)}
              onWheel={(e) => e.currentTarget.blur()}
            />
          </Field>
          <Field
            label={personas > 1 ? "Nombres de viajeros" : "Nombre del viajero"}
            className={personas > 1 ? "md:col-span-2" : ""}
          >
            <div className="space-y-2">
              {nombresArr.map((n, i) => (
                <input
                  key={i}
                  className="ckl-input"
                  value={n}
                  onChange={(e) =>
                    setNombresArr((arr) => arr.map((x, idx) => (idx === i ? e.target.value : x)))
                  }
                  placeholder={personas > 1 ? `Viajero ${i + 1}` : "Nombre completo"}
                />
              ))}
            </div>
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
            onChange({
              estado: e.target.value,
              hoteles: d.hoteles.map((h) => ({ ...h, monto: 0, hotel_id: 0 })),
            })
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
                    <select
                      className="ckl-input"
                      value={h.hotel_id}
                      onChange={(e) => {
                        const hotel_id = +e.target.value;
                        const chosen = filteredHotels.find((ho) => ho.id === hotel_id);
                        updateHotel(h.id, {
                          hotel_id,
                          monto: h.manual ? h.monto : (chosen?.tarifa_base ?? 0),
                        });
                      }}
                    >
                      <option value={0}>— Seleccionar —</option>
                      {filteredHotels.map((ho) => (
                        <option key={ho.id} value={ho.id}>{ho.nombre} — {fmtMoney(ho.tarifa_base)}</option>
                      ))}
                    </select>
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={h.manual}
                      onChange={(e) => updateHotel(h.id, { manual: e.target.checked })}
                    />
                    Monto manual por noche
                  </label>
                  {h.manual && (
                    <input
                      type="number"
                      className="ckl-input max-w-[140px]"
                      value={h.monto}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateHotel(h.id, { monto: +e.target.value })}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="Monto por noche"
                    />
                  )}
                </div>
                {h.monto > 0 && (
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
            <input
              type="number"
              placeholder="Monto"
              className="ckl-input"
              value={r.monto}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onChange(rows.map((x) => x.id === r.id ? { ...x, monto: +e.target.value } : x))}
              onWheel={(e) => e.currentTarget.blur()}
            />
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
            <input
              type="number"
              placeholder="Monto"
              className="ckl-input max-w-[160px]"
              value={r.monto}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onChange(rows.map((x) => x.id === r.id ? { ...x, monto: +e.target.value } : x))}
              onWheel={(e) => e.currentTarget.blur()}
            />
            <button onClick={() => onChange(rows.filter((x) => x.id !== r.id))} className="ckl-btn-ghost"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="ckl-card relative max-h-[85vh] w-full max-w-md overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {onClose && (
          <button onClick={onClose} className="absolute right-3 top-3 rounded p-1 hover:bg-secondary"><X size={16} /></button>
        )}
        {children}
      </div>
    </div>
  );
}
