import { randomUUID } from "node:crypto";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { conceptoRequierePar } from "../../src/lib/store.ts";
import { me, requireAuth, requirePerm } from "../auth.ts";
import { exec, newId, one, rows, tx } from "../db.ts";
import { bad, forbidden, HttpError, notFound } from "../http.ts";
import { comprobanteOut, facturaOut } from "../mappers.ts";
import { exigirAlcance } from "../services/solicitudes.ts";

export const comprobacionRouter = Router();
comprobacionRouter.use(requireAuth);

type R = Record<string, unknown>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
});

// ───────── consulta ─────────
comprobacionRouter.get("/facturas", async (req, res) => {
  const solicitudId = typeof req.query.solicitud_id === "string" ? req.query.solicitud_id : "";
  if (!solicitudId) throw bad("Indica la solicitud.");
  await exigirAlcance(me(req), solicitudId);
  const list = await rows<R>(
    "SELECT * FROM facturas WHERE solicitud_id = ? ORDER BY created_at DESC, id",
    [solicitudId],
  );
  res.json(list.map(facturaOut));
});

// Archivo (XML/PDF/foto) guardado en BD, para abrirlo desde el navegador.
comprobacionRouter.get("/facturas/:id/archivo", async (req, res) => {
  const f = await one<R>(
    `SELECT f.solicitud_id, f.archivo, a.mime, a.contenido
       FROM facturas f JOIN factura_archivos a ON a.factura_id = f.id WHERE f.id = ?`,
    [req.params.id],
  );
  if (!f) throw notFound("El archivo no existe.");
  await exigirAlcance(me(req), String(f.solicitud_id));
  res.setHeader("Content-Type", String(f.mime));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(f.archivo))}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(f.contenido as Buffer);
});

// ───────── subir comprobante (par XML + PDF; Vales: un solo archivo) ─────────
comprobacionRouter.post(
  "/comprobacion/renglones/:id/facturas",
  requirePerm("comprobar"),
  upload.fields([{ name: "xml", maxCount: 1 }, { name: "pdf", maxCount: 1 }]),
  async (req, res) => {
    const auth = me(req);
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const xml = files.xml?.[0];
    const pdf = files.pdf?.[0];

    const reng = await one<R>("SELECT * FROM comprobantes_gasto WHERE id = ?", [req.params.id]);
    if (!reng) throw notFound("El renglón de comprobación no existe.");
    const sol = await exigirAlcance(auth, String(reng.solicitud_id));
    if (sol.estatus !== "Cerrado") throw new HttpError(409, "Solo se comprueban solicitudes autorizadas.");
    if (auth.role.nombre === "gestor_vuelos" && reng.concepto !== "Avión") {
      throw forbidden("Solo puedes comprobar el concepto Avión.");
    }

    const esVales = !conceptoRequierePar(String(reng.concepto));
    if (esVales ? !pdf : !xml || !pdf) {
      throw bad(
        esVales
          ? "Sube una foto o un PDF de los vales."
          : "Para comprobar este concepto debes subir el XML y el PDF juntos.",
      );
    }

    for (const f of [xml, pdf]) {
      if (!f) continue;
      const nombre = Buffer.from(f.originalname, "latin1").toString("utf8");
      f.originalname = nombre;
      const dup = await one("SELECT 1 FROM facturas WHERE solicitud_id = ? AND archivo = ?", [reng.solicitud_id, nombre]);
      if (dup) throw bad(`El archivo "${nombre}" ya fue cargado para esta solicitud.`);
    }

    const uuid = ("UUID-" + randomUUID().slice(0, 8)).toUpperCase();
    // Si el XML no trae Total se simula (200–999), como en el prototipo.
    let total = Math.floor(Math.random() * 800) + 200;
    if (!esVales && xml) {
      const text = xml.buffer.toString("utf8");
      if (!text.includes("cfdi:Emisor") && !text.toLowerCase().includes("emisor")) {
        throw bad("El XML no es un CFDI válido (falta el Emisor). No se guardó el comprobante.");
      }
      const soc = await one<R>("SELECT rfc FROM sociedades WHERE nombre = ?", [sol.empresa]);
      const rfcMatch = text.match(/Receptor[^>]*Rfc=["']([^"']+)["']/i);
      if (rfcMatch && soc && String(rfcMatch[1]).toUpperCase() !== String(soc.rfc).toUpperCase()) {
        throw bad(`El RFC del receptor del XML no coincide con la sociedad (${soc.rfc}). No se guardó el comprobante.`);
      }
      const t = text.match(/\sTotal=["']([0-9][0-9.,]*)["']/i);
      const leido = t ? parseFloat(t[1].replace(/,/g, "")) : NaN;
      if (leido > 0) total = leido;
    }

    await tx(async (c) => {
      // Se bloquea el renglón para calcular el pendiente sin carreras.
      const r = await one<R>("SELECT monto_solicitado, monto_comprobado FROM comprobantes_gasto WHERE id = ? FOR UPDATE", [req.params.id], c);
      const pendiente = Number(r!.monto_solicitado) - Number(r!.monto_comprobado);
      const aplicado = Math.min(total, pendiente);
      if (aplicado <= 0) throw new HttpError(409, "Este concepto ya está comprobado por completo.");

      const parId = esVales ? null : newId("par_");
      const insertar = async (f: Express.Multer.File, tipo: string, montoAplicado: number) => {
        const id = newId("f_");
        await exec(
          `INSERT INTO facturas (id, solicitud_id, tipo, fecha, uuid, archivo, total, status, concepto_id, monto_aplicado, par_id)
           VALUES (?, ?, ?, CURDATE(), ?, ?, ?, 'Verificado', ?, ?, ?)`,
          [id, reng.solicitud_id, tipo, uuid, f.originalname, total, reng.id, montoAplicado, parId],
          c,
        );
        await exec("INSERT INTO factura_archivos (factura_id, mime, contenido) VALUES (?, ?, ?)", [id, f.mimetype || "application/octet-stream", f.buffer], c);
      };
      // El trigger trg_facturas_ai suma monto_aplicado al renglón y recalcula su status.
      if (!esVales && xml) await insertar(xml, "XML", aplicado);
      if (pdf) {
        const tipo = esVales && /\.(jpe?g|png)$/i.test(pdf.originalname) ? "FOTO" : "PDF";
        await insertar(pdf, tipo, esVales ? aplicado : 0);
      }
    }, auth.user.id);

    const r = await one<R>("SELECT * FROM comprobantes_gasto WHERE id = ?", [req.params.id]);
    res.status(201).json({ renglon: comprobanteOut(r!), uuid, total });
  },
);

// ───────── eliminar comprobante completo (par o archivo suelto); el trigger revierte el monto ─────────
comprobacionRouter.delete("/comprobacion/facturas/:key", requirePerm("comprobar"), async (req, res) => {
  const auth = me(req);
  const items = await rows<R>("SELECT id, solicitud_id FROM facturas WHERE par_id = ? OR id = ?", [req.params.key, req.params.key]);
  if (!items.length) throw notFound("El comprobante no existe.");
  await exigirAlcance(auth, String(items[0].solicitud_id));
  await tx((c) => exec("DELETE FROM facturas WHERE par_id = ? OR id = ?", [req.params.key, req.params.key], c), auth.user.id);
  res.json({ ok: true, eliminados: items.length });
});

// ───────── validación de Compras Corporativas ─────────
comprobacionRouter.patch("/comprobacion/renglones/:id/validacion", requirePerm("validar_comprobacion"), async (req, res) => {
  const auth = me(req);
  const body = z.object({ validado: z.boolean().optional(), nota: z.string().optional() }).parse(req.body);
  const r = await one<R>("SELECT * FROM comprobantes_gasto WHERE id = ?", [req.params.id]);
  if (!r) throw notFound("El renglón no existe.");
  await exigirAlcance(auth, String(r.solicitud_id));

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.validado === true) {
    if (!(Number(r.monto_solicitado) > 0) || r.status_renglon !== "comprobado") {
      throw new HttpError(409, "Solo se puede validar un renglón ya comprobado.");
    }
    sets.push("validado = 1", "validado_por = ?", "validado_fecha = CURDATE()");
    params.push(auth.user.id);
  } else if (body.validado === false) {
    sets.push("validado = 0", "validado_por = NULL", "validado_fecha = NULL");
  }
  if (body.nota !== undefined) {
    sets.push("nota_validacion = ?");
    params.push(body.nota.trim() || null);
  }
  if (sets.length) await exec(`UPDATE comprobantes_gasto SET ${sets.join(", ")} WHERE id = ?`, [...params, req.params.id]);
  res.json(comprobanteOut((await one<R>("SELECT * FROM comprobantes_gasto WHERE id = ?", [req.params.id]))!));
});
