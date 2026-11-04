import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { Request, RequestHandler, Response } from "express";

import { exec, one, rows } from "./db.ts";
import { forbidden, HttpError } from "./http.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const COOKIE = "ckl_sid";

export type AuthUser = {
  id: string;
  nombre: string;
  correo: string;
  rfc: string;
  rol_id: number;
  empresa: string;
  jefe_id: string | null;
  activo: boolean;
  initials: string;
};
export type AuthRole = { id: number; nombre: string; permisos: Record<string, boolean> };
export type Auth = { user: AuthUser; role: AuthRole };

declare module "express-serve-static-core" {
  interface Request {
    auth?: Auth;
  }
}

// ───────── contraseñas ─────────
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Acepta hash scrypt o, para los datos demo, texto plano (se re-hashea tras el primer login). */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  if (stored.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = stored.split("$");
    const hash = await scrypt(plain, Buffer.from(saltHex, "hex"), 64);
    return safeEq(hash.toString("hex"), hashHex);
  }
  return safeEq(stored, plain);
}

// ───────── usuarios / roles ─────────
const USER_COLS = "id, nombre, correo, rfc, rol_id, empresa, jefe_id, activo, initials";

export function toAuthUser(r: Record<string, unknown>): AuthUser {
  return {
    id: String(r.id),
    nombre: String(r.nombre),
    correo: String(r.correo),
    rfc: String(r.rfc),
    rol_id: Number(r.rol_id),
    empresa: String(r.empresa),
    jefe_id: (r.jefe_id as string | null) ?? null,
    activo: !!r.activo,
    initials: String(r.initials ?? ""),
  };
}

export async function loadRole(rolId: number): Promise<AuthRole | undefined> {
  const r = await one<{ id: number; nombre: string; permisos: Record<string, boolean> | string }>(
    "SELECT id, nombre, permisos FROM roles WHERE id = ?",
    [rolId],
  );
  if (!r) return undefined;
  const permisos = typeof r.permisos === "string" ? JSON.parse(r.permisos) : r.permisos;
  return { id: r.id, nombre: r.nombre, permisos };
}

export async function loadUserById(id: string): Promise<AuthUser | undefined> {
  const r = await one(`SELECT ${USER_COLS} FROM usuarios WHERE id = ?`, [id]);
  return r ? toAuthUser(r) : undefined;
}

export async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim().toLowerCase();
  return one<Record<string, unknown>>(
    `SELECT ${USER_COLS}, password FROM usuarios WHERE LOWER(correo) = ? OR LOWER(rfc) = ? LIMIT 1`,
    [id, id],
  );
}

// ───────── sesión única por usuario (cookie userId.token ↔ tabla sesiones) ─────────
export async function openSession(res: Response, userId: string) {
  const token = randomBytes(24).toString("hex");
  await exec(
    "INSERT INTO sesiones (user_id, token) VALUES (?, ?) ON DUPLICATE KEY UPDATE token = VALUES(token)",
    [userId, token],
  );
  res.cookie(COOKIE, `${userId}.${token}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export async function closeSession(req: Request, res: Response) {
  const raw = req.cookies?.[COOKIE] as string | undefined;
  const [userId, token] = raw ? splitCookie(raw) : [];
  if (userId && token) await exec("DELETE FROM sesiones WHERE user_id = ? AND token = ?", [userId, token]);
  res.clearCookie(COOKIE, { path: "/" });
}

function splitCookie(raw: string): [string, string] | [] {
  const i = raw.lastIndexOf(".");
  return i > 0 ? [raw.slice(0, i), raw.slice(i + 1)] : [];
}

async function resolveAuth(req: Request): Promise<Auth> {
  const raw = req.cookies?.[COOKIE] as string | undefined;
  if (!raw) throw new HttpError(401, "Inicia sesión para continuar.", "NO_AUTH");
  const [userId, token] = splitCookie(raw);
  if (!userId || !token) throw new HttpError(401, "Inicia sesión para continuar.", "NO_AUTH");
  const ses = await one<{ token: string }>("SELECT token FROM sesiones WHERE user_id = ?", [userId]);
  if (!ses) throw new HttpError(401, "Inicia sesión para continuar.", "NO_AUTH");
  if (ses.token !== token) {
    throw new HttpError(
      401,
      "Tu sesión se cerró porque este usuario inició sesión en otro lugar.",
      "SESSION_REPLACED",
    );
  }
  const user = await loadUserById(userId);
  if (!user || !user.activo) throw new HttpError(401, "Inicia sesión para continuar.", "NO_AUTH");
  const role = await loadRole(user.rol_id);
  if (!role) throw new HttpError(401, "Tu rol ya no existe.", "NO_AUTH");
  return { user, role };
}

/** Como requireAuth pero sin sesión NO falla (req.auth queda vacío); una sesión reemplazada sí devuelve 401. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    req.auth = await resolveAuth(req);
    next();
  } catch (e) {
    if (e instanceof HttpError && e.code === "NO_AUTH") return next();
    next(e);
  }
};

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    req.auth = await resolveAuth(req);
    next();
  } catch (e) {
    next(e);
  }
};

/** Exige al menos uno de los permisos indicados. */
export const requirePerm =
  (...perms: string[]): RequestHandler =>
  (req, _res, next) => {
    const p = req.auth?.role.permisos ?? {};
    if (perms.some((k) => p[k])) return next();
    next(forbidden());
  };

export const me = (req: Request): Auth => {
  if (!req.auth) throw new HttpError(401, "Inicia sesión para continuar.", "NO_AUTH");
  return req.auth;
};

export async function allUsersLite() {
  return rows(`SELECT ${USER_COLS} FROM usuarios ORDER BY nombre`);
}
