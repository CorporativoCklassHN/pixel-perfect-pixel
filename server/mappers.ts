// Conversión filas MySQL → los tipos que ya usa el front-end (src/lib/store.ts).
import type { Db } from "./db.ts";
import { rows } from "./db.ts";

type R = Record<string, unknown>;

/** 'YYYY-MM-DD HH:MM:SS.mmm' → ISO 'YYYY-MM-DDTHH:MM:SS.mmm' (sin zona, ordenable como texto). */
export const iso = (v: unknown): string | undefined =>
  v ? String(v).replace(" ", "T") : undefined;

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' (formato en que la UI muestra `Solicitud.fecha`). */
export const dmy = (v: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v ?? "");
};

export const day = (v: unknown): string | undefined => (v ? String(v).slice(0, 10) : undefined);

export function solicitudOut(r: R) {
  const out: R = {
    id: r.id,
    folio: r.folio,
    user_id: r.user_id,
    fecha: dmy(r.fecha),
    empresa: r.empresa,
    origen: r.origen,
    destino_resumen: r.destino_resumen,
    tipo_viaje: r.tipo_viaje,
    motivo: r.motivo,
    personas_count: r.personas_count,
    personas_nombres: r.personas_nombres,
    monto_total: r.monto_total,
    jefe_status: r.jefe_status,
    finanzas_status: r.finanzas_status,
    estatus: r.estatus,
    comprobante_viaje: r.comprobante_viaje ?? null,
    created_at: iso(r.created_at),
  };
  if (r.nota_rechazo) out.nota_rechazo = r.nota_rechazo;
  return out;
}

export function autorizacionOut(r: R) {
  return {
    id: r.id,
    solicitud_id: r.solicitud_id,
    rol_autorizador: r.rol_autorizador,
    user_id: r.user_id,
    status: r.status,
    fecha: day(r.fecha),
    nota: r.nota ?? "",
  };
}

export function comprobanteOut(r: R) {
  const out: R = {
    id: r.id,
    solicitud_id: r.solicitud_id,
    concepto: r.concepto,
    monto_solicitado: r.monto_solicitado,
    monto_comprobado: r.monto_comprobado,
    status_renglon: r.status_renglon,
  };
  if (r.validado) {
    out.validado = true;
    if (r.validado_por) out.validado_por = r.validado_por;
    if (r.validado_fecha) out.validado_fecha = day(r.validado_fecha);
  }
  if (r.nota_validacion) out.nota_validacion = r.nota_validacion;
  return out;
}

/** Factura sin contenido; el archivo se pide aparte en GET /api/facturas/:id/archivo. */
export function facturaOut(r: R) {
  return {
    id: r.id,
    solicitud_id: r.solicitud_id,
    tipo: r.tipo,
    fecha: dmy(r.fecha),
    uuid: r.uuid,
    archivo: r.archivo,
    total: r.total,
    status: r.status,
    concepto_id: r.concepto_id ?? null,
    monto_aplicado: r.monto_aplicado,
    par_id: r.par_id ?? undefined,
    url: `/api/facturas/${encodeURIComponent(String(r.id))}/archivo`,
  };
}

export function convenioOut(r: R) {
  const out: R = {
    id: r.id,
    anio: r.anio,
    tipo_sucursal: r.tipo_sucursal,
    no_sucursal: r.no_sucursal,
    destino: r.destino,
    estado: r.estado,
    nombre_comercial: r.nombre_comercial,
    costo_sencilla: r.costo_sencilla,
    costo_doble: r.costo_doble ?? null,
    no_proveedor: r.no_proveedor,
    razon_social: r.razon_social,
    telefono: r.telefono,
    contacto: r.contacto,
    banco: r.banco,
    correo: r.correo,
    notas: r.notas ?? "",
    activo: !!r.activo,
    creado_at: iso(r.creado_at),
    actualizado_at: iso(r.actualizado_at),
  };
  if (r.baja_motivo) out.baja_motivo = r.baja_motivo;
  if (r.baja_fecha) out.baja_fecha = iso(r.baja_fecha);
  return out;
}

export function revisionOut(r: R) {
  const out: R = {
    id: r.id,
    solicitud_id: r.solicitud_id,
    folio: r.folio,
    user_id: r.user_id,
    destino_estado: r.destino_estado,
    hotel_stay_id: r.hotel_stay_id,
    hotel_id: r.hotel_id ?? 0,
    hotel_nombre: r.hotel_nombre,
    tipo_habitacion: r.tipo_habitacion,
    tarifa_default: r.tarifa_default,
    monto_manual: r.monto_manual,
    noches: r.noches,
    fecha_inicio: day(r.fecha_inicio),
    fecha_fin: day(r.fecha_fin),
    creada_at: iso(r.creada_at),
    estado: r.estado,
  };
  if (r.motivo) out.motivo = r.motivo;
  if (!r.vigente) out.vigente = false;
  if (r.decidido_por) out.decidido_por = r.decidido_por;
  if (r.decidido_at) out.decidido_at = iso(r.decidido_at);
  if (r.comentario) out.comentario = r.comentario;
  return out;
}

export function hotelOut(r: R) {
  const out: R = {
    id: r.id,
    nombre: r.nombre,
    ciudad: r.ciudad,
    estado: r.estado,
    tarifa_base: r.tarifa_base,
    activo: !!r.activo,
  };
  if (r.tarifa_doble != null) out.tarifa_doble = r.tarifa_doble;
  if (r.convenio_clave) out.convenio_clave = r.convenio_clave;
  return out;
}

export const sociedadOut = (r: R) => ({
  id: r.id,
  nombre: r.nombre,
  rfc: r.rfc,
  regimen: r.regimen,
  cp: r.cp,
  UsoCFDI: r.uso_cfdi,
  sociedad_sap: r.sociedad_sap,
});

export function logOut(r: R) {
  return {
    id: r.id,
    fecha: iso(r.fecha),
    tipo: r.tipo,
    entidad: r.entidad,
    entidad_id: r.entidad_id,
    usuario_id: r.usuario_id ?? null,
    detalle: typeof r.detalle === "string" ? JSON.parse(r.detalle) : (r.detalle ?? {}),
  };
}

export const correoOut = (r: R) => ({
  id: r.id,
  fecha: iso(r.fecha),
  para: r.para,
  usuario_id: r.usuario_id,
  asunto: r.asunto,
  cuerpo: r.cuerpo,
  referencia: r.referencia,
  estado: r.estado,
});

/** Destinos de las solicitudes indicadas, con hoteles/transportes/vales anidados (forma de DestinoStored). */
export async function destinosDe(solicitudIds: string[], db?: Db) {
  if (!solicitudIds.length) return [];
  const ds = await rows<R>(
    "SELECT * FROM solicitud_destinos WHERE solicitud_id IN (?) ORDER BY fecha_inicio, id",
    [solicitudIds],
    db,
  );
  if (!ds.length) return [];
  const ids = ds.map((d) => d.id);
  const [hs, ts, vs] = await Promise.all([
    rows<R>("SELECT * FROM destino_hoteles WHERE destino_id IN (?) ORDER BY fecha_inicio, id", [ids], db),
    rows<R>("SELECT * FROM destino_transportes WHERE destino_id IN (?) ORDER BY id", [ids], db),
    rows<R>("SELECT * FROM destino_vales WHERE destino_id IN (?) ORDER BY id", [ids], db),
  ]);
  return ds.map((d) => {
    const hoteles = hs
      .filter((h) => h.destino_id === d.id)
      .map((h) => {
        const o: R = {
          id: h.id,
          fecha_inicio: day(h.fecha_inicio),
          fecha_fin: day(h.fecha_fin),
          monto: h.monto,
          manual: !!h.manual,
          hotel_id: h.hotel_id ?? 0,
          tipo_habitacion: h.tipo_habitacion,
        };
        if (h.motivo_cambio) o.motivo_cambio = h.motivo_cambio;
        return o;
      });
    const trans = (ambito: string) =>
      ts.filter((t) => t.destino_id === d.id && t.ambito === ambito).map((t) => ({ id: t.id, tipo: t.tipo, monto: t.monto }));
    return {
      id: d.id,
      solicitud_id: d.solicitud_id,
      estado: d.estado,
      fecha_inicio: day(d.fecha_inicio),
      fecha_fin: day(d.fecha_fin),
      hoteles,
      foraneo: trans("foraneo"),
      local: trans("local"),
      otros: vs.filter((v) => v.destino_id === d.id).map((v) => ({ id: v.id, concepto: v.concepto, monto: v.monto })),
      automovil: { gasolina: d.gasolina, caseta: d.caseta },
    };
  });
}
