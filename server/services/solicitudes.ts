// Alta / edición de solicitudes: folio, validaciones, monto total, destinos y renglones de comprobación.
// Port del handler `guardar` de _portal.solicitar.tsx, ahora ejecutado en el servidor.
import { z } from "zod";

import { tarifaHotel } from "../../src/lib/store.ts";
import type { Auth } from "../auth.ts";
import { exec, getPool, newId, one, rows, tx } from "../db.ts";
import { scopeSolicitudes } from "../scope.ts";
import { bad, forbidden, HttpError, notFound } from "../http.ts";
import { crearRevisionesMontoManual, type DestinoMonto } from "./revisiones.ts";

type R = Record<string, unknown>;

const monto = z.coerce.number().min(0).default(0);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

export const solicitudInput = z.object({
  origen: z.string().min(1, "Selecciona el origen."),
  tipo_viaje: z.string().min(1),
  motivo: z.string(),
  personas_count: z.coerce.number().int().min(1),
  personas_nombres: z.string().default(""),
  destinos: z
    .array(
      z.object({
        id: z.string().optional(),
        estado: z.string().min(1),
        fecha_inicio: z.string(),
        fecha_fin: z.string(),
        hoteles: z
          .array(
            z.object({
              id: z.string().optional(),
              fecha_inicio: z.string().default(""),
              fecha_fin: z.string().default(""),
              monto,
              manual: z.boolean().default(false),
              hotel_id: z.coerce.number().int().optional().default(0),
              tipo_habitacion: z.enum(["sencilla", "doble"]).optional(),
              motivo_cambio: z.string().optional(),
            }),
          )
          .default([]),
        foraneo: z.array(z.object({ id: z.string().optional(), tipo: z.string().min(1), monto })).default([]),
        local: z.array(z.object({ id: z.string().optional(), tipo: z.string().min(1), monto })).default([]),
        otros: z.array(z.object({ id: z.string().optional(), concepto: z.string().default(""), monto })).default([]),
        automovil: z.object({ gasolina: monto, caseta: monto }).default({ gasolina: 0, caseta: 0 }),
      }),
    )
    .min(1, "Agrega al menos un destino."),
});
export type SolicitudInput = z.infer<typeof solicitudInput>;

const dias = (a: string, b: string) =>
  !a || !b ? 0 : Math.max(0, Math.floor((Date.parse(b) - Date.parse(a)) / 86400000) + 1);
const noches = (a: string, b: string) => Math.max(0, dias(a, b) - 1);

/** Mensaje de bloqueo para una solicitud nueva (≥ 2 folios Cerrados sin comprobar) o null. */
export async function bloqueoNuevaSolicitud(userId: string): Promise<{ mensaje: string | null; folios: string[] }> {
  const [res] = (await getPool().query("CALL sp_folios_sin_comprobar(?)", [userId])) as unknown as [R[][]];
  const lista = (res[0] ?? []) as R[];
  if (lista.length < 2) return { mensaje: null, folios: lista.map((r) => String(r.folio)) };
  const folios = lista.map((r) => String(r.folio));
  return {
    mensaje: `Para generar una nueva solicitud necesitas concluir la comprobación de tus viáticos anteriores. Folios sin comprobar por completo: ${folios.join(", ")}.`,
    folios,
  };
}

function validar(input: SolicitudInput, hoyIso: string, catalogo: R[]) {
  if (!input.motivo.trim()) throw bad("Captura el motivo del viaje.");
  const ds = input.destinos;
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    if (!iso.safeParse(d.fecha_inicio).success || !iso.safeParse(d.fecha_fin).success) {
      throw bad(`Captura las fechas del destino ${i + 1}.`);
    }
    if (d.fecha_inicio < hoyIso) throw bad(`La fecha de inicio del destino ${i + 1} no puede ser anterior a hoy.`);
    if (d.fecha_fin < d.fecha_inicio) {
      throw bad(`La fecha fin del destino ${i + 1} no puede ser anterior a su fecha de inicio.`);
    }
    if (i > 0 && d.fecha_inicio < ds[i - 1].fecha_fin) {
      throw bad(`Las fechas del destino ${i + 1} se empalman con el destino ${i}.`);
    }
    d.hoteles.forEach((h, hi) => {
      if (!h.monto) return;
      if (!h.fecha_inicio || !h.fecha_fin) throw bad(`Captura las fechas del hotel ${hi + 1} en el destino ${i + 1}.`);
      if (h.fecha_fin < h.fecha_inicio) {
        throw bad(`El check-out del hotel ${hi + 1} (destino ${i + 1}) no puede ser anterior al check-in.`);
      }
      if (hi > 0 && h.fecha_inicio < d.hoteles[hi - 1].fecha_fin) {
        throw bad(`Las fechas del hotel ${hi + 1} se empalman con el hotel ${hi} (destino ${i + 1}).`);
      }
      const cat = catalogo.find((x) => x.id === h.hotel_id);
      const pred = tarifaHotel(
        cat ? { tarifa_base: Number(cat.tarifa_base), tarifa_doble: cat.tarifa_doble as number | null } : undefined,
        h.tipo_habitacion,
      );
      if (h.manual && h.monto !== pred && !h.motivo_cambio?.trim()) {
        throw bad(`Captura el motivo del cambio de monto del hotel ${hi + 1} en el destino ${i + 1}.`);
      }
    });
    const requiereHotel = noches(d.fecha_inicio, d.fecha_fin) > 0;
    const algunHotel = d.hoteles.some((h) => h.monto > 0);
    if (requiereHotel || algunHotel) {
      d.hoteles.forEach((h, hi) => {
        if (!(h.monto > 0)) {
          throw bad(
            requiereHotel && !algunHotel
              ? `Selecciona un hotel para el destino ${i + 1} (el viaje incluye noche(s) de hospedaje).`
              : `Falta seleccionar el hotel de la estancia ${hi + 1} en el destino ${i + 1}, o elimina esa fila si no la vas a usar.`,
          );
        }
      });
      if (d.hoteles[0].fecha_inicio !== d.fecha_inicio) {
        throw bad(`El primer hotel del destino ${i + 1} debe iniciar el ${d.fecha_inicio} (inicio del destino).`);
      }
      for (let k = 1; k < d.hoteles.length; k++) {
        if (d.hoteles[k].fecha_inicio !== d.hoteles[k - 1].fecha_fin) {
          throw bad(`Hay un hueco entre las fechas de los hoteles del destino ${i + 1}. Cúbrelo o ajusta las fechas.`);
        }
      }
      if (d.hoteles[d.hoteles.length - 1].fecha_fin !== d.fecha_fin) {
        throw bad(`El último hotel del destino ${i + 1} debe terminar el ${d.fecha_fin} (fin del destino).`);
      }
    }
  }
}

function calcularTotales(input: SolicitudInput, comidaDiaria: number) {
  let hotel = 0, foraneo = 0, local = 0, otros = 0, gasolina = 0, caseta = 0, diasTot = 0;
  for (const d of input.destinos) {
    for (const h of d.hoteles) hotel += h.monto * noches(h.fecha_inicio, h.fecha_fin);
    foraneo += d.foraneo.reduce((a, r) => a + r.monto, 0);
    local += d.local.reduce((a, r) => a + r.monto, 0);
    otros += d.otros.reduce((a, r) => a + r.monto, 0);
    gasolina += d.automovil.gasolina;
    caseta += d.automovil.caseta;
    diasTot += dias(d.fecha_inicio, d.fecha_fin);
  }
  const comida = diasTot * comidaDiaria * input.personas_count;
  const total = comida + foraneo + local + otros + hotel + gasolina + caseta;
  return { hotel, comida, otros, caseta, total };
}

export async function guardarSolicitud(auth: Auth, editId: string | null, raw: unknown) {
  const input = solicitudInput.parse(raw);
  const { user } = auth;

  const cfgRows = await rows<R>(
    "SELECT clave, valor FROM configuracion WHERE clave IN ('monto_comida_diario','umbral_finanzas')",
  );
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.clave, Number(r.valor)]));
  const comidaDiaria = cfg.monto_comida_diario ?? 450;
  const umbral = cfg.umbral_finanzas ?? 5000;
  const catalogo = await rows<R>("SELECT id, nombre, tarifa_base, tarifa_doble FROM hoteles");
  const hoyIso = (await one<{ d: string }>("SELECT CURDATE() AS d"))!.d;

  if (editId) {
    const s = await one<R>("SELECT * FROM solicitudes WHERE id = ?", [editId]);
    if (!s) throw notFound("La solicitud no existe.");
    const aut = await one<{ n: number }>("SELECT COUNT(*) n FROM autorizaciones WHERE solicitud_id = ?", [editId]);
    if (s.user_id !== user.id || s.estatus !== "Abierto" || (aut?.n ?? 0) > 0) {
      throw new HttpError(409, "Esa solicitud ya no se puede editar.");
    }
  } else {
    const b = await bloqueoNuevaSolicitud(user.id);
    if (b.mensaje) throw new HttpError(409, b.mensaje, "BLOQUEO_FOLIOS");
  }
  validar(input, hoyIso, catalogo);

  const totals = calcularTotales(input, comidaDiaria);
  const requiereFin = totals.total > umbral;
  const resumen = input.destinos.map((d) => d.estado).join(" - ");
  const destinoResumen = `${input.origen} - ${resumen}`;
  const nombres = input.personas_nombres.split(",").map((n) => n.trim()).filter(Boolean).join(", ");

  return tx(async (c) => {
    let solId = editId;
    let folio: string;
    if (editId) {
      const f = await one<{ folio: string }>("SELECT folio FROM solicitudes WHERE id = ? FOR UPDATE", [editId], c);
      folio = f!.folio;
      await exec(
        `UPDATE solicitudes SET origen = ?, destino_resumen = ?, tipo_viaje = ?, motivo = ?, personas_count = ?,
                personas_nombres = ?, monto_total = ?, finanzas_status = ? WHERE id = ?`,
        [input.origen, destinoResumen, input.tipo_viaje, input.motivo, input.personas_count, nombres,
          totals.total, requiereFin ? "Pendiente" : "N/A", editId],
        c,
      );
      await exec("DELETE FROM solicitud_destinos WHERE solicitud_id = ?", [editId], c);
      await exec("DELETE FROM comprobantes_gasto WHERE solicitud_id = ?", [editId], c);
    } else {
      await c.query("CALL sp_siguiente_folio(@folio_nuevo)");
      folio = (await one<{ f: string }>("SELECT @folio_nuevo AS f", [], c))!.f;
      solId = newId("s_");
      await exec(
        `INSERT INTO solicitudes (id, folio, user_id, fecha, empresa, origen, destino_resumen, tipo_viaje, motivo,
           personas_count, personas_nombres, monto_total, jefe_status, finanzas_status, estatus)
         VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, 'Abierto')`,
        [solId, folio, user.id, user.empresa, input.origen, destinoResumen, input.tipo_viaje, input.motivo,
          input.personas_count, nombres, totals.total, requiereFin ? "Pendiente" : "N/A"],
        c,
      );
    }

    // Destinos + detalle (hoteles, transportes, vales). El motivo del cambio solo se conserva
    // en las estancias con monto manual distinto al predeterminado.
    const destinosGuardados: DestinoMonto[] = [];
    for (const d of input.destinos) {
      const dId = d.id && !(await one("SELECT 1 FROM solicitud_destinos WHERE id = ?", [d.id], c)) ? d.id : newId("d_");
      await exec(
        "INSERT INTO solicitud_destinos (id, solicitud_id, estado, fecha_inicio, fecha_fin, gasolina, caseta) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [dId, solId, d.estado, d.fecha_inicio, d.fecha_fin, d.automovil.gasolina, d.automovil.caseta],
        c,
      );
      const hotelesOut: DestinoMonto["hoteles"] = [];
      for (const h of d.hoteles) {
        if (!(h.monto > 0)) continue; // estancia vacía: no se guarda
        const cat = catalogo.find((x) => x.id === h.hotel_id);
        const pred = tarifaHotel(
          cat ? { tarifa_base: Number(cat.tarifa_base), tarifa_doble: cat.tarifa_doble as number | null } : undefined,
          h.tipo_habitacion,
        );
        const cambia = h.manual && h.monto !== pred;
        const motivoCambio = cambia ? h.motivo_cambio?.trim() || null : null;
        const hId = h.id && !(await one("SELECT 1 FROM destino_hoteles WHERE id = ?", [h.id], c)) ? h.id : newId("hh_");
        await exec(
          `INSERT INTO destino_hoteles (id, destino_id, hotel_id, fecha_inicio, fecha_fin, monto, manual, tipo_habitacion, motivo_cambio)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [hId, dId, h.hotel_id || null, h.fecha_inicio, h.fecha_fin, h.monto, h.manual, h.tipo_habitacion ?? "sencilla", motivoCambio],
          c,
        );
        hotelesOut.push({
          id: hId, fecha_inicio: h.fecha_inicio, fecha_fin: h.fecha_fin, monto: h.monto, manual: h.manual,
          hotel_id: h.hotel_id || undefined, tipo_habitacion: h.tipo_habitacion, motivo_cambio: motivoCambio ?? undefined,
        });
      }
      for (const [ambito, lista] of [["foraneo", d.foraneo], ["local", d.local]] as const) {
        for (const t of lista) {
          await exec(
            "INSERT INTO destino_transportes (id, destino_id, ambito, tipo, monto) VALUES (?, ?, ?, ?, ?)",
            [newId("rt_"), dId, ambito, t.tipo, t.monto],
            c,
          );
        }
      }
      for (const o of d.otros) {
        await exec("INSERT INTO destino_vales (id, destino_id, concepto, monto) VALUES (?, ?, ?, ?)", [newId("ro_"), dId, o.concepto, o.monto], c);
      }
      destinosGuardados.push({ estado: d.estado, hoteles: hotelesOut });
    }

    // Renglones de comprobación: Hotel, uno por tipo de transporte usado ("Otro" se distingue entre
    // foráneo y local), Comida, Caseta (solo > 0) y Vales. La gasolina no se comprueba.
    const porTipo = new Map<string, number>();
    for (const d of input.destinos) {
      for (const r of d.foraneo) {
        if (r.monto > 0) {
          const k = r.tipo === "Otro" ? "Otro (foráneo)" : r.tipo;
          porTipo.set(k, (porTipo.get(k) ?? 0) + r.monto);
        }
      }
    }
    for (const d of input.destinos) {
      for (const r of d.local) {
        if (r.monto > 0) {
          const k = r.tipo === "Otro" ? "Otro (transporte local)" : r.tipo;
          porTipo.set(k, (porTipo.get(k) ?? 0) + r.monto);
        }
      }
    }
    const renglones: [string, number][] = [
      ["Hotel", totals.hotel],
      ...porTipo,
      ["Comida", totals.comida],
      ...(totals.caseta > 0 ? ([["Caseta", totals.caseta]] as [string, number][]) : []),
      ["Vales", totals.otros],
    ];
    for (const [concepto, m] of renglones) {
      await exec(
        "INSERT INTO comprobantes_gasto (id, solicitud_id, concepto, monto_solicitado, monto_comprobado, status_renglon) VALUES (?, ?, ?, ?, 0, 'pendiente')",
        [newId("cg_"), solId, concepto, m],
        c,
      );
    }

    await crearRevisionesMontoManual(c, { id: solId!, folio }, destinosGuardados, user);
    return { id: solId!, folio, monto_total: totals.total, editado: !!editId };
  }, user.id);
}

/** Verifica que la solicitud exista y que el usuario pueda verla (para acciones sobre un folio). */
export async function exigirAlcance(auth: Auth, solicitudId: string) {
  const sc = scopeSolicitudes(auth, false);
  const s = await one<R>(`SELECT s.* FROM solicitudes s WHERE s.id = ? AND ${sc.sql}`, [solicitudId, ...sc.params]);
  if (!s) throw forbidden("No tienes acceso a esta solicitud.");
  return s;
}
