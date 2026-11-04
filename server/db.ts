import process from "node:process";

import { createPool, type Pool, type PoolConnection } from "mysql2/promise";

// Pool único de MySQL. Las credenciales vienen de .env.local (ver .env.example).
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
    if (!DB_USER || !DB_NAME) {
      throw new Error("Falta configurar DB_USER y DB_NAME en .env.local (ver .env.example).");
    }
    pool = createPool({
      host: DB_HOST || "127.0.0.1",
      port: Number(DB_PORT || 3306),
      user: DB_USER,
      password: DB_PASSWORD ?? "",
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
      dateStrings: true, // DATE/DATETIME llegan como texto (sin conversión de zona horaria)
      decimalNumbers: true, // DECIMAL llega como number
      supportBigNumbers: true,
    });
  }
  return pool;
}

export type Db = Pick<Pool | PoolConnection, "query" | "execute">;

/** SELECT que devuelve filas. */
export async function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  const [res] = await db.query(sql, params);
  return res as T[];
}

/** Primera fila o undefined. */
export async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T | undefined> {
  return (await rows<T>(sql, params, db))[0];
}

/** INSERT/UPDATE/DELETE. */
export async function exec(sql: string, params: unknown[] = [], db: Db = getPool()) {
  const [res] = await db.query(sql, params);
  return res as { affectedRows: number; insertId: number };
}

/**
 * Ejecuta `fn` dentro de una transacción en una conexión dedicada. `usuarioId` se publica en
 * `@ckl_usuario_id` para que los triggers de bitácora sepan quién hizo el cambio.
 */
export async function tx<T>(
  fn: (c: PoolConnection) => Promise<T>,
  usuarioId: string | null = null,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET @ckl_usuario_id = ?", [usuarioId]);
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    await conn.query("SET @ckl_usuario_id = NULL").catch(() => undefined);
    conn.release();
  }
}

/**
 * Conexión dedicada SIN transacción abierta (para SPs que manejan la suya, p. ej.
 * sp_autorizar_solicitud). Publica `@ckl_usuario_id` para la bitácora de los triggers.
 */
export async function withConn<T>(
  usuarioId: string | null,
  fn: (c: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET @ckl_usuario_id = ?", [usuarioId]);
    return await fn(conn);
  } finally {
    await conn.query("SET @ckl_usuario_id = NULL").catch(() => undefined);
    conn.release();
  }
}

/** Id corto con prefijo, como los de la app (`s_ab12cd34`). */
export function newId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
