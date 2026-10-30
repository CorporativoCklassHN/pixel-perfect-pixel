import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search, Edit2, Ban, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useLocalStorage } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import {
  KEYS,
  ESTADOS_MX,
  registrarLog,
  sincronizarCatalogoConvenios,
  uid,
  type Convenio,
  type LogEvento,
  type User,
} from "@/lib/store";

export const Route = createFileRoute("/_portal/convenios")({
  head: () => ({ meta: [{ title: "Convenios — CKL" }] }),
  component: Convenios,
});

const ANIO_ACTUAL = new Date().getFullYear();

const moneda = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

const fh = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });

const ETIQUETA_CAMPO: Record<string, string> = {
  anio: "Año",
  tipo_sucursal: "Tipo de sucursal",
  no_sucursal: "No. de sucursal",
  destino: "Destino",
  estado: "Estado",
  nombre_comercial: "Nombre comercial",
  costo_sencilla: "Costo hab. sencilla",
  costo_doble: "Costo hab. doble",
  no_proveedor: "No. de proveedor",
  razon_social: "Razón social",
  telefono: "Teléfono",
  contacto: "Contacto",
  banco: "Banco",
  correo: "Correo",
  notas: "Notas",
};
const CAMPOS_EDITABLES = Object.keys(ETIQUETA_CAMPO) as (keyof Convenio)[];

const TIPO_LOG: Record<string, string> = {
  convenio_alta: "Alta",
  convenio_modificacion: "Modificación",
  convenio_baja: "Baja",
  convenio_reactivacion: "Reactivación",
};

function vacio(): Convenio {
  const ahora = new Date().toISOString();
  return {
    id: "",
    anio: new Date().getFullYear(),
    tipo_sucursal: "Center",
    no_sucursal: "",
    destino: "",
    estado: "",
    nombre_comercial: "",
    costo_sencilla: 0,
    costo_doble: null,
    no_proveedor: "",
    razon_social: "",
    telefono: "",
    contacto: "",
    banco: "",
    correo: "",
    notas: "",
    activo: true,
    creado_at: ahora,
    actualizado_at: ahora,
  };
}

// Altas, bajas y modificaciones de los convenios con hoteles (Compras Corporativas).
// La baja es lógica (se conserva el registro con motivo y fecha) y todo movimiento
// queda en la bitácora (ckl_logs).
function Convenios() {
  const { hasPerm, user } = useAuth();
  const [convenios, setConvenios] = useLocalStorage<Convenio[]>(KEYS.convenios, []);
  const [logs] = useLocalStorage<LogEvento[]>(KEYS.logs, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [q, setQ] = useState("");
  const [destino, setDestino] = useState("Todos");
  const [anio, setAnio] = useState("Todos");
  const [estatus, setEstatus] = useState("Todos");
  const [edit, setEdit] = useState<Convenio | null>(null);
  const [baja, setBaja] = useState<Convenio | null>(null);

  const destinos = useMemo(
    () => [...new Set(convenios.map((c) => c.destino))].sort((a, b) => a.localeCompare(b)),
    [convenios],
  );
  const anios = useMemo(
    () => [...new Set(convenios.map((c) => c.anio))].sort((a, b) => b - a),
    [convenios],
  );

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return convenios
      .filter((c) => {
        const coincide =
          !t ||
          [c.nombre_comercial, c.razon_social, c.no_proveedor, c.contacto, c.destino, c.no_sucursal]
            .join(" ")
            .toLowerCase()
            .includes(t);
        return (
          coincide &&
          (destino === "Todos" || c.destino === destino) &&
          (anio === "Todos" || String(c.anio) === anio) &&
          (estatus === "Todos" ||
            (estatus === "Vigentes"
              ? c.activo && c.anio === ANIO_ACTUAL
              : estatus === "Históricos"
                ? c.activo && c.anio < ANIO_ACTUAL
                : !c.activo))
        );
      })
      .sort(
        (a, b) =>
          b.anio - a.anio ||
          a.destino.localeCompare(b.destino) ||
          a.nombre_comercial.localeCompare(b.nombre_comercial),
      );
  }, [convenios, q, destino, anio, estatus]);

  if (!hasPerm("gestionar_convenios")) {
    return <div className="ckl-card p-8 text-center text-sm">Sin permiso para acceder.</div>;
  }

  const nombreUsuario = (id: string | null) => users.find((u) => u.id === id)?.nombre ?? "—";

  const guardar = (c: Convenio) => {
    const nombre = c.nombre_comercial.trim();
    const dest = c.destino.trim();
    if (!nombre) return showErrorDialog("Captura el nombre comercial del hotel.");
    if (!dest) return showErrorDialog("Captura el destino.");
    if (!c.estado) return showErrorDialog("Selecciona el estado del destino.");
    if (!(c.anio >= 2000 && c.anio <= 2100)) return showErrorDialog("Captura un año válido.");
    if (!(Number(c.costo_sencilla) > 0)) {
      return showErrorDialog("Captura el costo de la habitación sencilla (mayor a cero).");
    }
    if (c.costo_doble !== null && !(Number(c.costo_doble) > 0)) {
      return showErrorDialog("El costo de la habitación doble debe ser mayor a cero (o déjalo vacío).");
    }
    if (c.correo.trim() && !/^\S+@\S+\.\S+$/.test(c.correo.trim())) {
      return showErrorDialog("El correo no tiene un formato válido.");
    }
    const duplicado = convenios.some(
      (x) =>
        x.id !== c.id &&
        x.anio === c.anio &&
        x.destino.trim().toLowerCase() === dest.toLowerCase() &&
        x.nombre_comercial.trim().toLowerCase() === nombre.toLowerCase(),
    );
    if (duplicado) {
      return showErrorDialog(
        "Ya existe un convenio de ese hotel en ese destino y año. Modifica el existente.",
      );
    }

    const limpio: Convenio = {
      ...c,
      nombre_comercial: nombre,
      destino: dest,
      tipo_sucursal: c.tipo_sucursal.trim(),
      no_sucursal: c.no_sucursal.trim(),
      no_proveedor: c.no_proveedor.trim(),
      razon_social: c.razon_social.trim(),
      telefono: c.telefono.trim(),
      contacto: c.contacto.trim(),
      banco: c.banco.trim(),
      correo: c.correo.trim(),
      notas: c.notas.trim(),
    };
    const ahora = new Date().toISOString();

    if (!c.id) {
      const nuevo: Convenio = { ...limpio, id: uid("cv_"), activo: true, creado_at: ahora, actualizado_at: ahora };
      setConvenios([nuevo, ...convenios]);
      registrarLog("convenio_alta", "convenio", nuevo.id, user?.id ?? null, {
        hotel: nuevo.nombre_comercial,
        destino: nuevo.destino,
        anio: nuevo.anio,
        costo_sencilla: nuevo.costo_sencilla,
        costo_doble: nuevo.costo_doble,
      });
      sincronizarCatalogoConvenios(user?.id ?? null);
      toast.success(
        nuevo.anio === ANIO_ACTUAL
          ? "Convenio dado de alta (catálogo de hoteles actualizado)."
          : `Convenio de ${nuevo.anio} guardado como histórico (no se ofrece en Solicitar).`,
      );
    } else {
      const original = convenios.find((x) => x.id === c.id);
      const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
      for (const k of CAMPOS_EDITABLES) {
        if (original && original[k] !== limpio[k]) cambios[k] = { antes: original[k], despues: limpio[k] };
      }
      if (!Object.keys(cambios).length) {
        toast.message("No hay cambios que guardar.");
        setEdit(null);
        return;
      }
      setConvenios(convenios.map((x) => (x.id === c.id ? { ...limpio, actualizado_at: ahora } : x)));
      registrarLog("convenio_modificacion", "convenio", c.id, user?.id ?? null, {
        hotel: limpio.nombre_comercial,
        cambios,
      });
      sincronizarCatalogoConvenios(user?.id ?? null);
      toast.success("Convenio actualizado (catálogo de hoteles actualizado).");
    }
    setEdit(null);
  };

  const darBaja = (c: Convenio, motivo: string) => {
    const ahora = new Date().toISOString();
    setConvenios(
      convenios.map((x) =>
        x.id === c.id
          ? { ...x, activo: false, baja_motivo: motivo.trim() || undefined, baja_fecha: ahora, actualizado_at: ahora }
          : x,
      ),
    );
    registrarLog("convenio_baja", "convenio", c.id, user?.id ?? null, {
      hotel: c.nombre_comercial,
      motivo: motivo.trim(),
    });
    sincronizarCatalogoConvenios(user?.id ?? null);
    toast.success("Convenio dado de baja (el hotel ya no se ofrece en nuevas solicitudes).");
    setBaja(null);
  };

  const reactivar = (c: Convenio) => {
    const ahora = new Date().toISOString();
    setConvenios(
      convenios.map((x) =>
        x.id === c.id
          ? { ...x, activo: true, baja_motivo: undefined, baja_fecha: undefined, actualizado_at: ahora }
          : x,
      ),
    );
    registrarLog("convenio_reactivacion", "convenio", c.id, user?.id ?? null, { hotel: c.nombre_comercial });
    sincronizarCatalogoConvenios(user?.id ?? null);
    toast.success("Convenio reactivado (el hotel vuelve a ofrecerse en nuevas solicitudes).");
  };

  // Vigente = activo del año en curso (el que se ofrece en Solicitar); Histórico = activo de
  // años anteriores (solo estadísticas/comparativas); Baja = dado de baja.
  const insignia = (c: Convenio) => {
    const ui = !c.activo
      ? { t: "Baja", bg: "#FEE9EA", fg: "#E30613" }
      : c.anio === ANIO_ACTUAL
        ? { t: "Vigente", bg: "#D8F3DC", fg: "#2D6A4F" }
        : { t: "Histórico", bg: "#F1F3F5", fg: "#555" };
    return (
      <span
        className="ckl-badge"
        style={{ background: ui.bg, color: ui.fg }}
        title={
          !c.activo
            ? `${c.baja_motivo ?? "Sin motivo"}${c.baja_fecha ? " · " + fh(c.baja_fecha) : ""}`
            : c.anio === ANIO_ACTUAL
              ? "Se ofrece en Solicitar viáticos"
              : "Año anterior: solo para estadísticas y comparativas; no se ofrece en Solicitar"
        }
      >
        {ui.t}
      </span>
    );
  };

  const acciones = (c: Convenio) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEdit(c)}
        className="rounded p-1.5 hover:bg-secondary"
        title="Modificar convenio"
        aria-label={`Modificar ${c.nombre_comercial}`}
      >
        <Edit2 size={14} />
      </button>
      {c.activo ? (
        <button
          onClick={() => setBaja(c)}
          className="rounded p-1.5 hover:bg-secondary"
          style={{ color: "var(--color-primary)" }}
          title="Dar de baja"
          aria-label={`Dar de baja ${c.nombre_comercial}`}
        >
          <Ban size={14} />
        </button>
      ) : (
        <button
          onClick={() => reactivar(c)}
          className="rounded p-1.5 hover:bg-secondary"
          title="Reactivar"
          aria-label={`Reactivar ${c.nombre_comercial}`}
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="ckl-card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[200px] flex-1">
          <label className="ckl-label">Buscar</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input
              className="ckl-input pl-8"
              placeholder="Hotel, razón social, proveedor, contacto..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="ckl-label">Destino</label>
          <select className="ckl-input" value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option>Todos</option>
            {destinos.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ckl-label">Año</label>
          <select className="ckl-input" value={anio} onChange={(e) => setAnio(e.target.value)}>
            <option>Todos</option>
            {anios.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ckl-label">Estatus</label>
          <select className="ckl-input" value={estatus} onChange={(e) => setEstatus(e.target.value)}>
            {["Todos", "Vigentes", "Históricos", "Baja"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setEdit(vacio())} className="ckl-btn-primary">
          <Plus size={14} /> Nuevo convenio
        </button>
      </div>

      <div className="ckl-card overflow-hidden">
        {/* Móvil (< 768 px): tarjetas apiladas */}
        <ul className="divide-y md:hidden">
          {filtrados.map((c) => (
            <li key={c.id} className="space-y-1.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{c.nombre_comercial}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.destino}
                    {c.estado ? `, ${c.estado}` : ""} · {c.anio} · {c.tipo_sucursal} {c.no_sucursal}
                  </div>
                </div>
                {insignia(c)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Sencilla</div>
                  <div className="font-semibold">{moneda(c.costo_sencilla)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Doble</div>
                  <div className="font-semibold">{moneda(c.costo_doble)}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {c.razon_social || "—"} · Prov. {c.no_proveedor || "—"}
              </div>
              {(c.contacto || c.telefono) && (
                <div className="text-xs">
                  {c.contacto} {c.telefono && <span className="text-muted-foreground">· {c.telefono}</span>}
                </div>
              )}
              {c.notas && <div className="text-xs text-muted-foreground">{c.notas}</div>}
              <div className="flex justify-end">{acciones(c)}</div>
            </li>
          ))}
          {filtrados.length === 0 && (
            <li className="p-8 text-center text-sm text-muted-foreground">Sin convenios</li>
          )}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-xs">
            <thead className="bg-secondary text-left text-muted-foreground">
              <tr>
                <th className="p-3">Año</th>
                <th className="p-3">Sucursal</th>
                <th className="p-3">Destino</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Nombre comercial</th>
                <th className="p-3 text-right">Sencilla</th>
                <th className="p-3 text-right">Doble</th>
                <th className="p-3">No. proveedor</th>
                <th className="p-3">Razón social</th>
                <th className="p-3">Teléfono</th>
                <th className="p-3">Contacto</th>
                <th className="p-3">Banco</th>
                <th className="p-3">Correo</th>
                <th className="p-3">Notas</th>
                <th className="p-3">Estatus</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr
                  key={c.id}
                  className="border-t align-top"
                  style={c.activo ? undefined : { background: "#FAFAFA", color: "#777" }}
                >
                  <td className="p-3">{c.anio}</td>
                  <td className="whitespace-nowrap p-3">
                    {c.tipo_sucursal} {c.no_sucursal}
                  </td>
                  <td className="p-3">{c.destino}</td>
                  <td className="p-3">{c.estado || "—"}</td>
                  <td className="p-3 font-semibold">{c.nombre_comercial}</td>
                  <td className="whitespace-nowrap p-3 text-right">{moneda(c.costo_sencilla)}</td>
                  <td className="whitespace-nowrap p-3 text-right">{moneda(c.costo_doble)}</td>
                  <td className="p-3">{c.no_proveedor}</td>
                  <td className="min-w-[180px] p-3">{c.razon_social}</td>
                  <td className="whitespace-nowrap p-3">{c.telefono}</td>
                  <td className="min-w-[140px] p-3">{c.contacto}</td>
                  <td className="p-3">{c.banco}</td>
                  <td className="p-3 break-all">{c.correo}</td>
                  <td className="min-w-[200px] p-3">{c.notas}</td>
                  <td className="p-3">{insignia(c)}</td>
                  <td className="p-3">{acciones(c)}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={16} className="p-8 text-center text-sm text-muted-foreground">
                    Sin convenios
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t bg-secondary p-2 text-[11px] text-muted-foreground">
          {filtrados.length} de {convenios.length} convenio(s). Solo los convenios <b>vigentes</b> (año{" "}
          {ANIO_ACTUAL}) se ofrecen en Solicitar viáticos; los de años anteriores se conservan como
          histórico para estadísticas y comparativas. La baja es lógica.
        </div>
      </div>

      {edit && (
        <ConvenioForm
          inicial={edit}
          historial={logs
            .filter((l) => l.entidad === "convenio" && l.entidad_id === edit.id)
            .sort((a, b) => b.fecha.localeCompare(a.fecha))
            .slice(0, 8)}
          nombreUsuario={nombreUsuario}
          onClose={() => setEdit(null)}
          onSave={guardar}
        />
      )}
      {baja && <BajaDialog convenio={baja} onClose={() => setBaja(null)} onConfirm={darBaja} />}
    </div>
  );
}

function ConvenioForm({
  inicial,
  historial,
  nombreUsuario,
  onClose,
  onSave,
}: {
  inicial: Convenio;
  historial: LogEvento[];
  nombreUsuario: (id: string | null) => string;
  onClose: () => void;
  onSave: (c: Convenio) => void;
}) {
  const [c, setC] = useState<Convenio>(inicial);
  const set = <K extends keyof Convenio>(k: K, v: Convenio[K]) => setC((x) => ({ ...x, [k]: v }));
  const texto = (k: keyof Convenio, label: string, extra?: string) => (
    <div className={extra}>
      <label className="ckl-label">{label}</label>
      <input
        className="ckl-input"
        value={String(c[k] ?? "")}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </div>
  );
  const numero = (
    k: "costo_sencilla" | "costo_doble",
    label: string,
    opcional = false,
  ) => (
    <div>
      <label className="ckl-label">{label}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        className="ckl-input"
        value={c[k] ?? ""}
        placeholder={opcional ? "Opcional" : ""}
        onFocus={(e) => e.target.select()}
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => {
          const v = e.target.value;
          set(k, (v === "" ? (opcional ? null : 0) : Number(v)) as never);
        }}
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="ckl-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={inicial.id ? "Modificar convenio" : "Nuevo convenio"}
      >
        <h3 className="text-lg font-semibold">
          {inicial.id ? "Modificar convenio" : "Nuevo convenio"}
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="ckl-label">Año</label>
            <input
              type="number"
              className="ckl-input"
              value={c.anio}
              onChange={(e) => set("anio", Number(e.target.value))}
            />
          </div>
          {texto("destino", "Destino (ciudad)")}
          <div>
            <label className="ckl-label">Estado</label>
            <select
              className="ckl-input"
              value={c.estado}
              onChange={(e) => set("estado", e.target.value)}
            >
              <option value="">— Seleccionar —</option>
              {ESTADOS_MX.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </div>
          {texto("tipo_sucursal", "Tipo de sucursal")}
          {texto("no_sucursal", "No. de sucursal")}
          {texto("nombre_comercial", "Nombre comercial", "sm:col-span-2")}
          {numero("costo_sencilla", "Costo hab. sencilla (por noche) — tarifa predeterminada")}
          {numero("costo_doble", "Costo hab. doble (por noche) — opcional", true)}
          {texto("no_proveedor", "No. de proveedor")}
          {texto("banco", "Banco")}
          {texto("razon_social", "Razón social", "sm:col-span-2")}
          {texto("telefono", "Teléfono")}
          {texto("contacto", "Contacto")}
          {texto("correo", "Correo", "sm:col-span-2")}
          <div className="sm:col-span-2">
            <label className="ckl-label">Notas</label>
            <textarea
              className="ckl-input min-h-[70px]"
              value={c.notas}
              onChange={(e) => set("notas", e.target.value)}
              placeholder="Condiciones del convenio, referencias, observaciones..."
            />
          </div>
        </div>

        {historial.length > 0 && (
          <div className="mt-4 rounded-md border">
            <div className="border-b bg-secondary px-3 py-2 text-xs font-semibold">Historial</div>
            <ul className="divide-y text-xs">
              {historial.map((l) => (
                <li key={l.id} className="px-3 py-2">
                  <b>{TIPO_LOG[l.tipo] ?? l.tipo}</b> · {fh(l.fecha)} · {nombreUsuario(l.usuario_id)}
                  {l.tipo === "convenio_modificacion" && (
                    <div className="mt-0.5 text-muted-foreground">
                      {Object.entries((l.detalle.cambios ?? {}) as Record<string, { antes: unknown; despues: unknown }>)
                        .map(
                          ([k, v]) =>
                            `${ETIQUETA_CAMPO[k] ?? k}: ${String(v.antes ?? "—")} → ${String(v.despues ?? "—")}`,
                        )
                        .join("; ")}
                    </div>
                  )}
                  {l.tipo === "convenio_baja" && l.detalle.motivo ? (
                    <div className="mt-0.5 text-muted-foreground">{String(l.detalle.motivo)}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="ckl-btn-ghost">
            Cancelar
          </button>
          <button onClick={() => onSave(c)} className="ckl-btn-primary">
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function BajaDialog({
  convenio,
  onClose,
  onConfirm,
}: {
  convenio: Convenio;
  onClose: () => void;
  onConfirm: (c: Convenio, motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="ckl-card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Dar de baja convenio"
      >
        <h3 className="text-lg font-semibold">Dar de baja convenio</h3>
        <p className="mt-2 text-sm">
          ¿Dar de baja el convenio de <b>{convenio.nombre_comercial}</b> ({convenio.destino},{" "}
          {convenio.anio})? Podrás reactivarlo después.
        </p>
        <div className="mt-3">
          <label className="ckl-label">Motivo (opcional)</label>
          <textarea
            className="ckl-input min-h-[80px]"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej. El hotel ya no ofrece la tarifa convenida."
            maxLength={300}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="ckl-btn-ghost">
            Cancelar
          </button>
          <button onClick={() => onConfirm(convenio, motivo)} className="ckl-btn-primary">
            Dar de baja
          </button>
        </div>
      </div>
    </div>
  );
}
