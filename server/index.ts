import process from "node:process";

import cookieParser from "cookie-parser";
import express from "express";

import { getPool } from "./db.ts";
import { errorHandler, HttpError } from "./http.ts";
import { adminRouter } from "./routes/admin.ts";
import { authRouter } from "./routes/auth.ts";
import { comprobacionRouter } from "./routes/comprobacion.ts";
import { comprasRouter } from "./routes/compras.ts";
import { solicitudesRouter } from "./routes/solicitudes.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  const [r] = await getPool().query("SELECT VERSION() AS version, DATABASE() AS db");
  res.json({ ok: true, ...(r as object[])[0] });
});

// Rutas públicas (login, reset, pre-registro) y autenticadas.
app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", solicitudesRouter);
app.use("/api", comprobacionRouter);
app.use("/api", comprasRouter);

app.use("/api", () => {
  throw new HttpError(404, "Ruta no encontrada.");
});
app.use(errorHandler);

const port = Number(process.env.API_PORT || 3001);
app.listen(port, "127.0.0.1", () => {
  console.log(`API Portal de Viáticos escuchando en http://127.0.0.1:${port}`);
});
