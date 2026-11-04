// Uso: npm run db:setup
// Ejecuta db/schema.sql (tablas, vistas, SPs, triggers y datos demo) con el cliente `mysql`.
// Lee DB_HOST/DB_PORT/DB_USER/DB_PASSWORD de .env.local (vía `node --env-file`).
// ¡Borra y recrea todas las tablas de la base portal_viaticos!
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
if (!DB_USER) {
  console.error("Falta DB_USER en .env.local (ver .env.example).");
  process.exit(1);
}

const candidatos = [
  "mysql",
  "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe",
  "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
];
const mysql = candidatos.find((c) => c === "mysql" || existsSync(c));

const schemaPath = new URL("../db/schema.sql", import.meta.url);
const sql = readFileSync(schemaPath);

function ejecutar(bin) {
  return spawnSync(
    bin,
    [
      "--default-character-set=utf8mb4",
      `--host=${DB_HOST || "127.0.0.1"}`,
      `--port=${DB_PORT || "3306"}`,
      `--user=${DB_USER}`,
      "--table",
    ],
    {
      input: sql,
      env: { ...process.env, MYSQL_PWD: DB_PASSWORD ?? "" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

let r = ejecutar(mysql);
if (r.error && r.error.code === "ENOENT") {
  const alterno = candidatos.find((c) => c !== "mysql" && existsSync(c));
  if (!alterno) {
    console.error("No se encontró el cliente `mysql`. Agrega su carpeta bin al PATH.");
    process.exit(1);
  }
  r = ejecutar(alterno);
}

if (r.stdout) process.stdout.write(r.stdout);
if (r.status !== 0) {
  console.error(r.stderr || r.error?.message || "Error al ejecutar db/schema.sql");
  process.exit(r.status ?? 1);
}
console.log("db/schema.sql ejecutado correctamente.");
