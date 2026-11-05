// Montos manuales de hotel → revisión de Compras (campanita + correo simulado + bitácora).
// Port de la lógica de revisiones de monto manual que antes vivía en el front-end.
import type { PoolConnection } from "mysql2/promise";

import { tarifaHotel, type TipoHabitacion } from "../../src/lib/store.ts";
import type { AuthUser } from "../auth.ts";
import { exec, newId, rows } from "../db.ts";

type R = Record<string, unknown>;

export type DestinoMonto = {
  estado: string;
  hoteles: {
    id: string;
    fecha_inicio: string;
    fecha_fin: string;
    monto: number;
    manual: boolean;
    hotel_id?: number;
    motivo_cambio?: string;
    tipo_habitacion?: TipoHabitacion;
  }[];
};

function nochesEntre(a: string, b: string) {
  if (!a || !b) return 0;
  const dias = Math.floor((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  return Math.max(0, dias - 1);
}

const money = (n: number) => "$" + n.toLocaleString("es-MX");

function cuerpoCorreo(r: {
  folio: string; hotel_nombre: string; destino_estado: string; tipo_habitacion: string;
  fecha_inicio: string; fecha_fin: string; noches: number; tarifa_default: number;
  monto_manual: number; motivo?: string;
}, solicitante: string) {
  const dif = r.monto_manual - r.tarifa_default;
  return [
    `${solicitante} guardó la solicitud ${r.folio} con un hotel a un monto distinto al predeterminado.`,
    "",
    `Hotel: ${r.hotel_nombre} (${r.destino_estado}) · Habitación ${r.tipo_habitacion === "doble" ? "doble" : "sencilla"}`,
    `Fechas: ${r.fecha_inicio} al ${r.fecha_fin} (${r.noches} noche(s))`,
    r.tarifa_default > 0
      ? `Monto predeterminado por noche: ${money(r.tarifa_default)}`
      : "Monto predeterminado: sin hotel de catálogo",
    `Monto manual por noche: ${money(r.monto_manual)}`,
    r.motivo ? `Motivo del usuario: ${r.motivo}` : "",
    r.tarifa_default > 0 ? `Diferencia por noche: ${dif >= 0 ? "+" : "-"}${money(Math.abs(dif))}` : "",
    "",
    "Este correo es solo informativo. La revisión (aceptar o rechazar con comentario) se hace en el portal, en la campanita de notificaciones.",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

/**
 * Se llama al guardar una solicitud (alta o edición) dentro de su transacción. Abre una revisión
 * por cada estancia con monto manual distinto al del catálogo; las pendientes se regeneran con los
 * montos vigentes y las resueltas se conservan (sin repetirse si el monto no cambió).
 */
export async function crearRevisionesMontoManual(
  c: PoolConnection,
  sol: { id: string; folio: string },
  destinos: DestinoMonto[],
  solicitante: AuthUser,
) {
  const hoteles = await rows<R>("SELECT id, nombre, tarifa_base, tarifa_doble FROM hoteles", [], c);
  const existentes = await rows<R>("SELECT * FROM revisiones_monto WHERE solicitud_id = ?", [sol.id], c);
  const resueltas = existentes.filter((r) => r.estado !== "pendiente");
  const previas = existentes.filter((r) => r.estado === "pendiente");

  type Nueva = {
    id: string; destino_estado: string; hotel_stay_id: string; hotel_id: number | null;
    hotel_nombre: string; tipo_habitacion: TipoHabitacion; tarifa_default: number;
    monto_manual: number; motivo?: string; noches: number; fecha_inicio: string; fecha_fin: string;
  };
  const nuevas: Nueva[] = [];
  const conservadas: { id: string; motivo: string | null }[] = [];
  const resueltasVigentes: string[] = [];

  for (const d of destinos) {
    for (const h of d.hoteles) {
      if (!h.manual || !(Number(h.monto) > 0)) continue;
      const cat = hoteles.find((x) => x.id === h.hotel_id);
      const tipo: TipoHabitacion = h.tipo_habitacion === "doble" ? "doble" : "sencilla";
      const tarifa = tarifaHotel(
        cat ? { tarifa_base: Number(cat.tarifa_base), tarifa_doble: cat.tarifa_doble as number | null } : undefined,
        tipo,
      );
      if (cat && Number(h.monto) === tarifa) continue;
      const hotelId = h.hotel_id ?? 0;
      const igual = (r: R) =>
        r.hotel_stay_id === h.id &&
        Number(r.hotel_id ?? 0) === hotelId &&
        Number(r.monto_manual) === Number(h.monto) &&
        (r.tipo_habitacion ?? "sencilla") === tipo;
      const previa = previas.find(igual);
      if (previa) {
        conservadas.push({ id: String(previa.id), motivo: h.motivo_cambio?.trim() || null });
        continue;
      }
      const resuelta = resueltas.find(igual);
      if (resuelta) {
        resueltasVigentes.push(String(resuelta.id));
        continue;
      }
      nuevas.push({
        id: newId("rev_"),
        destino_estado: d.estado,
        hotel_stay_id: h.id,
        hotel_id: hotelId || null,
        hotel_nombre: cat ? String(cat.nombre) : "Hotel fuera de catálogo",
        tipo_habitacion: tipo,
        tarifa_default: tarifa,
        monto_manual: Number(h.monto),
        motivo: h.motivo_cambio?.trim() || undefined,
        noches: nochesEntre(h.fecha_inicio, h.fecha_fin),
        fecha_inicio: h.fecha_inicio,
        fecha_fin: h.fecha_fin,
      });
    }
  }

  // Pendientes que ya no corresponden se descartan; las conservadas solo actualizan el motivo.
  const idsConservadas = conservadas.map((x) => x.id);
  await exec(
    `DELETE FROM revisiones_monto WHERE solicitud_id = ? AND estado = 'pendiente'
       ${idsConservadas.length ? "AND id NOT IN (?)" : ""}`,
    idsConservadas.length ? [sol.id, idsConservadas] : [sol.id],
    c,
  );
  for (const x of conservadas) await exec("UPDATE revisiones_monto SET motivo = ? WHERE id = ?", [x.motivo, x.id], c);

  // Resueltas que ya no aplican (se cambió hotel/monto) quedan sin vigencia; las demás, vigentes.
  const idsVigentes = [...idsConservadas, ...resueltasVigentes];
  await exec(
    `UPDATE revisiones_monto SET vigente = ${idsVigentes.length ? "(id IN (?))" : "0"}
      WHERE solicitud_id = ?`,
    idsVigentes.length ? [idsVigentes, sol.id] : [sol.id],
    c,
  );

  if (!nuevas.length) return [];

  const cfg = await rows<R>("SELECT valor FROM configuracion WHERE clave = 'notif_email_activo'", [], c);
  const correoActivo = !cfg.length || String(cfg[0].valor) !== "false";
  const destinatarios = await rows<R>(
    `SELECT u.id, u.correo FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 AND u.id <> ? AND JSON_UNQUOTE(JSON_EXTRACT(r.permisos, '$.revisar_monto_manual')) = 'true'`,
    [solicitante.id],
    c,
  );

  for (const n of nuevas) {
    await exec(
      `INSERT INTO revisiones_monto (id, solicitud_id, folio, user_id, destino_estado, hotel_stay_id, hotel_id,
         hotel_nombre, tipo_habitacion, tarifa_default, monto_manual, motivo, noches, fecha_inicio, fecha_fin,
         creada_at, estado, vigente)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), 'pendiente', 1)`,
      [n.id, sol.id, sol.folio, solicitante.id, n.destino_estado, n.hotel_stay_id, n.hotel_id, n.hotel_nombre,
        n.tipo_habitacion, n.tarifa_default, n.monto_manual, n.motivo ?? null, n.noches, n.fecha_inicio, n.fecha_fin],
      c,
    );
    await c.query("CALL sp_registrar_log(?, ?, ?, ?, ?)", [
      "monto_manual_detectado", "revision_monto", n.id, solicitante.id,
      JSON.stringify({
        folio: sol.folio, hotel: n.hotel_nombre, tarifa_default: n.tarifa_default,
        monto_manual: n.monto_manual, noches: n.noches, destinatarios: destinatarios.map((u) => u.correo),
      }),
    ]);
    for (const u of destinatarios) {
      await exec(
        `INSERT INTO correos (id, fecha, para, usuario_id, asunto, cuerpo, referencia, estado)
         VALUES (?, NOW(3), ?, ?, ?, ?, ?, ?)`,
        [newId("mail_"), u.correo, u.id, `Monto manual de hotel — ${sol.folio} (${solicitante.nombre})`,
          cuerpoCorreo({ ...n, folio: sol.folio }, solicitante.nombre), n.id, correoActivo ? "simulado" : "omitido"],
        c,
      );
      await c.query("CALL sp_registrar_log(?, ?, ?, ?, ?)", [
        correoActivo ? "correo_enviado_simulado" : "correo_omitido", "revision_monto", n.id, solicitante.id,
        JSON.stringify({ para: u.correo }),
      ]);
    }
  }
  return nuevas;
}

