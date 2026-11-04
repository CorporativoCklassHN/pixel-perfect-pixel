import { Router } from "express";
import { z } from "zod";

import { me, requireAuth, requirePerm } from "../auth.ts";
import { exec, one, rows, withConn } from "../db.ts";
import { bad, forbidden, HttpError, notFound } from "../http.ts";
import { autorizacionOut, comprobanteOut, destinosDe, solicitudOut } from "../mappers.ts";
import { scopeSolicitudes } from "../scope.ts";
import { bloqueoNuevaSolicitud, exigirAlcance, guardarSolicitud } from "../services/solicitudes.ts";

export const solicitudesRouter = Router();
solicitudesRouter.use(requireAuth);

type R = Record<string, unknown>;

const conVentana = (q: unknown) => q !== "0" && q !== "false";

// ───────── listados (siempre filtrados por alcance del rol) ─────────
solicitudesRouter.get("/solicitudes", async (req, res) => {
  const sc = scopeSolicitudes(me(req), conVentana(req.query.ventana));
  const list = await rows<R>(`SELECT s.* FROM solicitudes s WHERE ${sc.sql} ORDER BY s.created_at DESC, s.folio DESC`, sc.params);
  res.json(list.map(solicitudOut));
});

solicitudesRouter.get("/autorizaciones", async (req, res) => {
  const sc = scopeSolicitudes(me(req), conVentana(req.query.ventana));
  const list = await rows<R>(
    `SELECT a.* FROM autorizaciones a JOIN solicitudes s ON s.id = a.solicitud_id WHERE ${sc.sql} ORDER BY a.fecha, a.id`,
    sc.params,
  );
  res.json(list.map(autorizacionOut));
});

solicitudesRouter.get("/comprobantes", async (req, res) => {
  const sc = scopeSolicitudes(me(req), conVentana(req.query.ventana));
  const list = await rows<R>(
    `SELECT c.* FROM comprobantes_gasto c JOIN solicitudes s ON s.id = c.solicitud_id WHERE ${sc.sql} ORDER BY s.created_at DESC, c.seq`,
    sc.params,
  );
  res.json(list.map(comprobanteOut));
});

solicitudesRouter.get("/destinos", async (req, res) => {
  const auth = me(req);
  const solicitudId = typeof req.query.solicitud_id === "string" ? req.query.solicitud_id : null;
  if (solicitudId) {
    await exigirAlcance(auth, solicitudId);
    res.json(await destinosDe([solicitudId]));
    return;
  }
  const sc = scopeSolicitudes(auth, conVentana(req.query.ventana));
  const ids = (await rows<R>(`SELECT s.id FROM solicitudes s WHERE ${sc.sql}`, sc.params)).map((r) => String(r.id));
  res.json(await destinosDe(ids));
});

// Para el botón "Nueva solicitud" y el acceso directo a /solicitar.
solicitudesRouter.get("/solicitudes/bloqueo", async (req, res) => {
  res.json(await bloqueoNuevaSolicitud(me(req).user.id));
});

solicitudesRouter.get("/solicitudes/:id", async (req, res) => {
  const auth = me(req);
  const s = await exigirAlcance(auth, String(req.params.id));
  const [destinos, aut] = await Promise.all([
    destinosDe([req.params.id]),
    rows<R>("SELECT * FROM autorizaciones WHERE solicitud_id = ? ORDER BY fecha, id", [req.params.id]),
  ]);
  res.json({ solicitud: solicitudOut(s), destinos, autorizaciones: aut.map(autorizacionOut) });
});

// ───────── alta / edición / baja ─────────
solicitudesRouter.post("/solicitudes", async (req, res) => {
  const out = await guardarSolicitud(me(req), null, req.body);
  res.status(201).json(out);
});

solicitudesRouter.put("/solicitudes/:id", async (req, res) => {
  const out = await guardarSolicitud(me(req), req.params.id, req.body);
  res.json(out);
});

solicitudesRouter.delete("/solicitudes/:id", async (req, res) => {
  const { user } = me(req);
  const s = await one<R>("SELECT user_id, estatus, folio FROM solicitudes WHERE id = ?", [req.params.id]);
  if (!s) throw notFound("La solicitud no existe.");
  if (s.user_id !== user.id) throw forbidden("Solo quien la creó puede eliminar la solicitud.");
  if (s.estatus !== "Abierto") throw new HttpError(409, "Solo se pueden eliminar solicitudes abiertas.");
  await withConn(user.id, (c) => exec("DELETE FROM solicitudes WHERE id = ?", [req.params.id], c)); // trigger: sin autorizaciones
  res.json({ ok: true });
});

// ───────── autorización (reglas en sp_autorizar_solicitud) ─────────
async function decidir(userId: string, solicitudId: string, decision: "autorizado" | "rechazado", nota: string | null) {
  await withConn(userId, (c) => c.query("CALL sp_autorizar_solicitud(?, ?, ?, ?)", [solicitudId, userId, decision, nota]));
  const s = await one<R>("SELECT * FROM solicitudes WHERE id = ?", [solicitudId]);
  return solicitudOut(s!);
}

solicitudesRouter.post("/solicitudes/:id/autorizar", async (req, res) => {
  const auth = me(req);
  await exigirAlcance(auth, String(req.params.id));
  res.json(await decidir(auth.user.id, req.params.id, "autorizado", null));
});

solicitudesRouter.post("/solicitudes/:id/rechazar", async (req, res) => {
  const auth = me(req);
  const { nota } = z.object({ nota: z.string() }).parse(req.body);
  if (!nota.trim()) throw bad("Captura el motivo.");
  await exigirAlcance(auth, String(req.params.id));
  res.json(await decidir(auth.user.id, req.params.id, "rechazado", nota.trim()));
});

solicitudesRouter.post("/solicitudes/:id/revertir", async (req, res) => {
  const { user } = me(req);
  await withConn(user.id, (c) => c.query("CALL sp_revertir_autorizaciones(?, ?)", [req.params.id, user.id]));
  res.json(solicitudOut((await one<R>("SELECT * FROM solicitudes WHERE id = ?", [req.params.id]))!));
});

solicitudesRouter.post("/solicitudes/:id/comprobante-viaje", requirePerm("subir_comprobantes_viaje"), async (req, res) => {
  await exigirAlcance(me(req), String(req.params.id));
  const hoy = new Date().toLocaleDateString("es-MX");
  await exec("UPDATE solicitudes SET comprobante_viaje = ? WHERE id = ?", [hoy, req.params.id]);
  res.json({ comprobante_viaje: hoy });
});
