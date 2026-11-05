import type { Auth } from "./auth.ts";

// Roles con visibilidad extendida (4 meses); el resto, 2 (igual que visibilityMonthsBack en el front).
const EXTENDED = ["administrador", "finanzas", "compras_corporativas", "jefe_inmediato"];

/**
 * Cláusula SQL de alcance para `solicitudes` con alias `s`:
 *  - ver_todo → todo; ver_equipo → su equipo (jefe_id) + propias; otro → solo propias.
 *  - ventana de fechas: 4 o 2 meses según el rol (`conVentana` = false la omite, p. ej. en detalle por id).
 */
export function scopeSolicitudes(auth: Auth, conVentana = true): { sql: string; params: unknown[] } {
  const { user, role } = auth;
  const parts: string[] = [];
  const params: unknown[] = [];
  if (role.permisos.ver_todo) {
    parts.push("1=1");
  } else if (role.permisos.ver_equipo) {
    parts.push("(s.user_id = ? OR s.user_id IN (SELECT id FROM usuarios WHERE jefe_id = ?))");
    params.push(user.id, user.id);
  } else {
    parts.push("s.user_id = ?");
    params.push(user.id);
  }
  if (conVentana) {
    const meses = EXTENDED.includes(role.nombre) ? 4 : 2;
    parts.push("s.created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)");
    params.push(meses);
  }
  return { sql: parts.join(" AND "), params };
}
