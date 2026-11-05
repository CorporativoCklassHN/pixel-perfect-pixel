import { randomInt } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { evaluarContrasena, PASSWORD_MIN_LENGTH } from "../../src/lib/store.ts";
import {
  closeSession,
  findUserByIdentifier,
  hashPassword,
  loadRole,
  me,
  openSession,
  optionalAuth,
  requireAuth,
  toAuthUser,
  verifyPassword,
} from "../auth.ts";
import { exec, newId, one, rows } from "../db.ts";
import { bad, HttpError } from "../http.ts";

export const authRouter = Router();

const RESET_TTL_MIN = 10;

authRouter.post("/auth/login", async (req, res) => {
  const { identifier, password } = z
    .object({ identifier: z.string().min(1), password: z.string().min(1) })
    .parse(req.body);
  const u = await findUserByIdentifier(identifier);
  const stored = u ? String(u.password) : "";
  if (!u || !u.activo || !(await verifyPassword(stored, password))) {
    throw new HttpError(401, "Usuario o contraseña incorrectos.", "BAD_CREDENTIALS");
  }
  // Datos demo con contraseña en claro: se convierten a hash en el primer acceso.
  if (!stored.startsWith("scrypt$")) {
    await exec("UPDATE usuarios SET password = ? WHERE id = ?", [await hashPassword(password), u.id]);
  }
  await openSession(res, String(u.id));
  const user = toAuthUser(u);
  res.json({ user, role: await loadRole(user.rol_id) });
});

authRouter.post("/auth/logout", async (req, res) => {
  await closeSession(req, res);
  res.json({ ok: true });
});

// Sin sesión responde 200 con user: null (así la página de login no genera errores 401 en consola).
authRouter.get("/auth/me", optionalAuth, (req, res) => {
  if (!req.auth) return void res.json({ user: null, role: null });
  res.json({ user: req.auth.user, role: req.auth.role });
});

authRouter.post("/auth/cambiar-contrasena", requireAuth, async (req, res) => {
  const { actual, nueva } = z.object({ actual: z.string().min(1), nueva: z.string().min(1) }).parse(req.body);
  const { user } = me(req);
  const row = await one<{ password: string }>("SELECT password FROM usuarios WHERE id = ?", [user.id]);
  if (!row || !(await verifyPassword(row.password, actual))) {
    throw new HttpError(400, "La contraseña actual no es correcta.", "ACTUAL_INCORRECTA");
  }
  const reglas = evaluarContrasena(nueva, user);
  if (!reglas.longitud) throw bad(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  if (!reglas.noComun) throw bad("La contraseña es demasiado común o fácil de adivinar.");
  if (nueva === actual) throw bad("La nueva contraseña debe ser distinta de la actual.");
  await exec("UPDATE usuarios SET password = ? WHERE id = ?", [await hashPassword(nueva), user.id]);
  res.json({ ok: true });
});

// Sin servidor de correo: el código se devuelve en la respuesta ("correo simulado").
authRouter.post("/auth/reset/solicitar", async (req, res) => {
  const { identifier } = z.object({ identifier: z.string().min(1) }).parse(req.body);
  const u = await findUserByIdentifier(identifier);
  if (!u || !u.activo) throw new HttpError(404, "No encontramos una cuenta activa con ese RFC/usuario.");
  const code = String(randomInt(100000, 1000000));
  await exec("INSERT INTO reset_codes (id, user_id, code) VALUES (?, ?, ?)", [newId("rc_"), u.id, code]);
  res.json({ code, correo: u.correo });
});

authRouter.post("/auth/reset/confirmar", async (req, res) => {
  const { identifier, code, nueva } = z
    .object({ identifier: z.string().min(1), code: z.string().min(1), nueva: z.string().min(1) })
    .parse(req.body);
  if (nueva.length < PASSWORD_MIN_LENGTH) throw bad(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  const u = await findUserByIdentifier(identifier);
  const match = u
    ? await one<{ id: string }>(
        `SELECT id FROM reset_codes
          WHERE user_id = ? AND code = ? AND used = 0
            AND created_at >= DATE_SUB(NOW(3), INTERVAL ${RESET_TTL_MIN} MINUTE)
          ORDER BY created_at DESC LIMIT 1`,
        [u.id, code.trim()],
      )
    : undefined;
  if (!u || !match) throw bad("Código inválido o expirado.");
  await exec("UPDATE reset_codes SET used = 1 WHERE id = ?", [match.id]);
  await exec("UPDATE usuarios SET password = ? WHERE id = ?", [await hashPassword(nueva), u.id]);
  res.json({ ok: true });
});

// Pre-registro público (el administrador lo revisa en Usuarios).
authRouter.post("/prealtas", async (req, res) => {
  const f = z
    .object({
      nombre: z.string().min(1),
      correo: z.string().min(1),
      rfc: z.string().optional().default(""),
      banco: z.string().optional().default(""),
      cuenta: z.string().optional().default(""),
      clabe: z.string().optional().default(""),
      sociedad: z.string().optional().default(""),
      password: z.string().min(1),
    })
    .parse(req.body);
  await exec(
    `INSERT INTO prealtas (id, nombre, correo, rfc, banco, cuenta, clabe, sociedad, password, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
    [newId("pa_"), f.nombre, f.correo, f.rfc, f.banco, f.cuenta, f.clabe, f.sociedad, await hashPassword(f.password)],
  );
  res.status(201).json({ ok: true });
});

export async function listPrealtas() {
  return rows(
    "SELECT id, nombre, correo, rfc, banco, cuenta, clabe, sociedad, status, created_at FROM prealtas ORDER BY created_at DESC",
  );
}
