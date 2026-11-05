// Uso: npm run db:check  (lee .env.local con --env-file)
import process from "node:process";

import { createConnection } from "mysql2/promise";

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
if (!DB_USER || !DB_NAME) {
  console.error("Falta DB_USER o DB_NAME. Copia .env.example a .env.local y complétalo.");
  process.exit(1);
}
try {
  const conn = await createConnection({
    host: DB_HOST || "127.0.0.1",
    port: Number(DB_PORT || 3306),
    user: DB_USER,
    password: DB_PASSWORD ?? "",
    database: DB_NAME,
  });
  const [rows] = await conn.query("SELECT VERSION() AS version, DATABASE() AS db");
  console.log("Conexión OK:", rows[0]);
  await conn.end();
} catch (e) {
  console.error("Error de conexión:", e.code ?? "", e.message);
  process.exit(1);
}
