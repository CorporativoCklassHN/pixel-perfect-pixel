import { Router } from "express";
import { z } from "zod";

import { hashPassword, me, requireAuth, requirePerm, toAuthUser } from "../auth.ts";
import { exec, newId, one, rows, tx } from "../db.ts";
import { bad, forbidden, HttpError, notFound } from "../http.ts";
import { correoOut, hotelOut, logOut, sociedadOut } from "../mappers.ts";
import { listPrealtas } from "./auth.ts";

export const adminRouter = Router();
adminRouter.use(requireAuth);

type R = Record<string, unknown>;

// ───────── catálogos ─────────
adminRouter.get("/catalogos", async (_req, res) => {
  const [soc, hot, ori, est] = await Promise.all([
    rows<R>("SELECT * FROM sociedades ORDER BY id"),
    rows<R>("SELECT * FROM hoteles ORDER BY id"),
    rows<R>("SELECT nombre FROM origenes ORDER BY id"),
    rows<R>("SELECT nombre FROM estados_mx ORDER BY nombre"),
  ]);
  res.json({
    sociedades: soc.map(sociedadOut),
    hoteles: hot.map(hotelOut),
    origenes: ori.map((o) => o.nombre),
    estados: est.map((e) => e.nombre),
  });
});

// ───────── configuración ─────────
export async function loadConfig(): Promise<Record<string, unknown>> {
  const list = await rows<{ clave: string; valor: unknown }>("SELECT clave, valor FROM configuracion");
  const cfg: Record<string, unknown> = {};
  for (const r of list) cfg[r.clave] = r.valor; // mysql2 ya entrega el JSON parseado
  return cfg;
}

adminRouter.get("/config", async (req, res) => {
  const cfg = await loadConfig();
  // La contraseña SMTP solo la ve quien administra montos/configuración.
  if (!me(req).role.permisos.configurar_montos) delete cfg.smtp_password;
  res.json(cfg);
});

const CONFIG_KEYS = new Set([
  "monto_comida_diario", "umbral_finanzas", "dia_deposito", "email_compras",
  "dias_comprobacion_atrasada", "dias_autorizacion_pendiente", "dias_recordatorio_viaje",
  "notif_email_activo", "notif_email_destinatarios", "smtp_servidor", "smtp_puerto", "smtp_usuario",
  "smtp_password", "smtp_cifrado", "notif_plataforma_activo", "revision_automatica_activo",
  "bloquear_folio_monto_hotel",
]);

adminRouter.put("/config", requirePerm("configurar_montos"), async (req, res) => {
  const body = z.record(z.string(), z.unknown()).parse(req.body);
  const auth = me(req);
  const antes = await loadConfig();
  await tx(async (c) => {
    for (const [k, v] of Object.entries(body)) {
      if (!CONFIG_KEYS.has(k)) continue;
      await exec(
        "INSERT INTO configuracion (clave, valor) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
        [k, JSON.stringify(v)],
        c,
      );
    }
    if (
      "bloquear_folio_monto_hotel" in body &&
      !!antes.bloquear_folio_monto_hotel !== !!body.bloquear_folio_monto_hotel
    ) {
      await c.query("CALL sp_registrar_log(?, ?, ?, ?, ?)", [
        "config_bloqueo_monto_hotel", "config", "bloquear_folio_monto_hotel", auth.user.id,
        JSON.stringify({ antes: !!antes.bloquear_folio_monto_hotel, despues: !!body.bloquear_folio_monto_hotel }),
      ]);
    }
  }, auth.user.id);
  const cfg = await loadConfig();
  res.json(cfg);
});

// ───────── sociedades ─────────
const sociedadSchema = z.object({
  nombre: z.string().min(1),
  rfc: z.string().min(1),
  regimen: z.string().default(""),
  cp: z.string().default(""),
  UsoCFDI: z.string().default("G03"),
  sociedad_sap: z.string().default(""),
});

adminRouter.post("/sociedades", requirePerm("configurar_montos"), async (req, res) => {
  const s = sociedadSchema.parse(req.body);
  const r = await exec(
    "INSERT INTO sociedades (nombre, rfc, regimen, cp, uso_cfdi, sociedad_sap) VALUES (?, ?, ?, ?, ?, ?)",
    [s.nombre, s.rfc, s.regimen, s.cp, s.UsoCFDI, s.sociedad_sap],
  );
  res.status(201).json(sociedadOut((await one<R>("SELECT * FROM sociedades WHERE id = ?", [r.insertId]))!));
});

adminRouter.put("/sociedades/:id", requirePerm("configurar_montos"), async (req, res) => {
  const s = sociedadSchema.parse(req.body);
  const r = await exec(
    "UPDATE sociedades SET nombre = ?, rfc = ?, regimen = ?, cp = ?, uso_cfdi = ?, sociedad_sap = ? WHERE id = ?",
    [s.nombre, s.rfc, s.regimen, s.cp, s.UsoCFDI, s.sociedad_sap, req.params.id],
  );
  if (!r.affectedRows) throw notFound();
  res.json(sociedadOut((await one<R>("SELECT * FROM sociedades WHERE id = ?", [req.params.id]))!));
});

// ───────── roles y permisos ─────────
const parsePerm = (v: unknown): Record<string, boolean> => (typeof v === "string" ? JSON.parse(v) : (v as Record<string, boolean>));

adminRouter.get("/roles", async (_req, res) => {
  const list = await rows<R>("SELECT id, nombre, permisos FROM roles ORDER BY id");
  res.json(list.map((r) => ({ id: r.id, nombre: r.nombre, permisos: parsePerm(r.permisos) })));
});

adminRouter.post("/roles", requirePerm("configurar_montos"), async (req, res) => {
  const { nombre, copiarDe } = z
    .object({ nombre: z.string().min(1), copiarDe: z.number().int().optional() })
    .parse(req.body);
  const plantilla = copiarDe ? await one<R>("SELECT permisos FROM roles WHERE id = ?", [copiarDe]) : undefined;
  const permisos = plantilla ? parsePerm(plantilla.permisos) : {};
  if (await one("SELECT id FROM roles WHERE nombre = ?", [nombre])) throw bad("Ya existe un rol con ese nombre.");
  const r = await exec("INSERT INTO roles (nombre, permisos) VALUES (?, CAST(? AS JSON))", [nombre, JSON.stringify(permisos)]);
  res.status(201).json({ id: r.insertId, nombre, permisos });
});

adminRouter.delete("/roles/:id", requirePerm("configurar_montos"), async (req, res) => {
  const rol = await one<R>("SELECT nombre FROM roles WHERE id = ?", [req.params.id]);
  if (!rol) throw notFound();
  const enUso = await one<{ n: number }>("SELECT COUNT(*) n FROM usuarios WHERE rol_id = ?", [req.params.id]);
  if (enUso && enUso.n > 0) {
    throw new HttpError(409, `No se puede eliminar "${rol.nombre}": ${enUso.n} usuario(s) lo tienen asignado.`);
  }
  await exec("DELETE FROM roles WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

// Guardado de la matriz completa (como la pantalla de Permisos).
adminRouter.put("/roles/permisos", requirePerm("configurar_permisos"), async (req, res) => {
  const list = z
    .array(z.object({ id: z.number().int(), permisos: z.record(z.string(), z.boolean()) }))
    .parse(req.body);
  await tx(async (c) => {
    for (const r of list) {
      await exec("UPDATE roles SET permisos = CAST(? AS JSON) WHERE id = ?", [JSON.stringify(r.permisos), r.id], c);
    }
  }, me(req).user.id);
  res.json({ ok: true });
});

// ───────── usuarios ─────────
const COLS = "id, nombre, correo, rfc, rol_id, empresa, jefe_id, activo, initials";

adminRouter.get("/usuarios", async (_req, res) => {
  const list = await rows<R>(`SELECT ${COLS} FROM usuarios ORDER BY nombre`);
  res.json(list.map(toAuthUser));
});

const userSchema = z.object({
  nombre: z.string().min(1, "Captura el nombre."),
  correo: z.string().min(1, "Captura el correo."),
  rfc: z.string().min(1, "Captura el RFC."),
  rol_id: z.number().int(),
  empresa: z.string().min(1),
  jefe_id: z.string().nullable().optional(),
  activo: z.boolean().default(true),
  initials: z.string().default(""),
  password: z.string().optional(),
});

async function esAdminRol(rolId: number) {
  const r = await one<R>("SELECT nombre FROM roles WHERE id = ?", [rolId]);
  return r?.nombre === "administrador";
}

adminRouter.post("/usuarios", requirePerm("gestionar_usuarios"), async (req, res) => {
  const u = userSchema.parse(req.body);
  if (!u.password) throw bad("Captura la contraseña.");
  if ((await esAdminRol(u.rol_id)) && me(req).role.nombre !== "administrador") {
    throw forbidden("Solo un administrador puede asignar el rol de administrador.");
  }
  const id = newId("u_");
  await exec(
    `INSERT INTO usuarios (id, nombre, correo, password, rfc, rol_id, empresa, jefe_id, activo, initials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, u.nombre, u.correo, await hashPassword(u.password), u.rfc, u.rol_id, u.empresa, u.jefe_id ?? null, u.activo, u.initials],
  );
  res.status(201).json(toAuthUser((await one<R>(`SELECT ${COLS} FROM usuarios WHERE id = ?`, [id]))!));
});

adminRouter.put("/usuarios/:id", requirePerm("gestionar_usuarios"), async (req, res) => {
  const u = userSchema.parse(req.body);
  const actual = await one<R>(`SELECT ${COLS} FROM usuarios WHERE id = ?`, [req.params.id]);
  if (!actual) throw notFound("El usuario no existe.");
  const soyAdmin = me(req).role.nombre === "administrador";
  if (!soyAdmin && ((await esAdminRol(Number(actual.rol_id))) || (await esAdminRol(u.rol_id)))) {
    throw forbidden("Solo un administrador puede modificar cuentas de administrador.");
  }
  const sets = ["nombre = ?", "correo = ?", "rfc = ?", "rol_id = ?", "empresa = ?", "jefe_id = ?", "activo = ?", "initials = ?"];
  const params: unknown[] = [u.nombre, u.correo, u.rfc, u.rol_id, u.empresa, u.jefe_id ?? null, u.activo, u.initials];
  if (u.password) {
    sets.push("password = ?");
    params.push(await hashPassword(u.password));
  }
  await exec(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`, [...params, req.params.id]);
  res.json(toAuthUser((await one<R>(`SELECT ${COLS} FROM usuarios WHERE id = ?`, [req.params.id]))!));
});

adminRouter.get("/prealtas", requirePerm("gestionar_usuarios"), async (_req, res) => {
  res.json(await listPrealtas());
});

// ───────── bitácora y correos simulados ─────────
adminRouter.get("/logs", requirePerm("configurar_montos", "ver_reportes", "gestionar_convenios"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const entidad = typeof req.query.entidad === "string" ? req.query.entidad : null;
  const entidadId = typeof req.query.entidad_id === "string" ? req.query.entidad_id : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (entidad) { where.push("entidad = ?"); params.push(entidad); }
  if (entidadId) { where.push("entidad_id = ?"); params.push(entidadId); }
  const list = await rows<R>(
    `SELECT * FROM logs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY fecha DESC LIMIT ?`,
    [...params, limit],
  );
  res.json(list.map(logOut));
});

adminRouter.get("/correos", requirePerm("configurar_montos"), async (_req, res) => {
  const list = await rows<R>("SELECT * FROM correos ORDER BY fecha DESC LIMIT 200");
  res.json(list.map(correoOut));
});
