import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = "No tienes permiso para realizar esta acción.") =>
  new HttpError(403, msg);
export const notFound = (msg = "No se encontró el registro.") => new HttpError(404, msg);

type MysqlError = { code?: string; errno?: number; sqlState?: string; sqlMessage?: string };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    res.status(400).json({ error: first ? `${first.path.join(".")}: ${first.message}` : "Datos inválidos." });
    return;
  }
  const e = err as MysqlError;
  // SIGNAL SQLSTATE '45000' desde SPs/triggers: mensaje de negocio ya en español.
  if (e?.sqlState === "45000" && e.sqlMessage) {
    res.status(409).json({ error: e.sqlMessage });
    return;
  }
  if (e?.code === "ER_DUP_ENTRY") {
    res.status(409).json({ error: "Ya existe un registro con esos datos." });
    return;
  }
  if (e?.code === "ER_ROW_IS_REFERENCED_2") {
    res.status(409).json({ error: "No se puede eliminar: el registro está en uso." });
    return;
  }
  if ((err as { type?: string })?.type === "entity.too.large") {
    res.status(413).json({ error: "El archivo es demasiado grande." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
};
