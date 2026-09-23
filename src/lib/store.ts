// CKL Portal de Viáticos — centralized localStorage store

export type Role = {
  id: number;
  // string (no unión literal): los administradores pueden dar de alta roles
  // nuevos desde Configuración, así que el set de nombres válidos es dinámico.
  nombre: string;
  permisos: Record<string, boolean>;
};

export type User = {
  id: string;
  nombre: string;
  correo: string;
  password: string;
  rfc: string;
  rol_id: number;
  empresa: string;
  jefe_id: string | null;
  activo: boolean;
  initials: string;
};

export type Sociedad = {
  id: number;
  nombre: string;
  rfc: string;
  regimen: string;
  cp: string;
  UsoCFDI: string;
  sociedad_sap: string;
};

export type Hotel = {
  id: number;
  nombre: string;
  ciudad: string;
  estado: string;
  tarifa_base: number;
  activo: boolean;
};

export type Solicitud = {
  id: string;
  folio: string;
  user_id: string;
  fecha: string;
  empresa: string;
  origen: string;
  destino_resumen: string;
  tipo_viaje: string;
  motivo: string;
  personas_count: number;
  personas_nombres: string;
  monto_total: number;
  jefe_status: "Pendiente" | "Autorizado" | "Rechazado";
  finanzas_status: "Pendiente" | "Autorizado" | "Rechazado" | "N/A";
  estatus: "Abierto" | "Cerrado" | "Rechazado";
  comprobante_viaje: string | null;
  nota_rechazo?: string;
  created_at: string;
};

export type Autorizacion = {
  id: string;
  solicitud_id: string;
  rol_autorizador: string;
  user_id: string;
  status: "autorizado" | "rechazado";
  fecha: string;
  nota: string;
};

// Un solo dispositivo/pestaña por usuario: se guarda el token de la sesión más
// reciente para esa cuenta; cualquier otra sesión abierta con el mismo usuario
// detecta el cambio y se cierra sola (ver AuthProvider).
export type SessionInfo = {
  userId: string;
  token: string;
};

export type ResetCode = {
  id: string;
  user_id: string;
  code: string;
  created_at: string;
  used: boolean;
};

export type ComprobanteGasto = {
  id: string;
  solicitud_id: string;
  concepto: string;
  monto_solicitado: number;
  monto_comprobado: number;
  status_renglon: "comprobado" | "parcialmente_comprobado" | "pendiente" | "no_aplica";
};

export function lsGet<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function lsSet<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("ckl:storage", { detail: { key } }));
}

export const KEYS = {
  user: "ckl_user",
  roles: "ckl_roles",
  users: "ckl_users",
  prealtas: "ckl_prealtas",
  solicitudes: "ckl_solicitudes",
  destinos: "ckl_destinos",
  gastos: "ckl_gastos",
  autorizaciones: "ckl_autorizaciones",
  notas: "ckl_notas",
  comprobantesViaje: "ckl_comprobantes_viaje",
  comprobantesGasto: "ckl_comprobantes_gasto",
  facturasXml: "ckl_facturas_xml",
  config: "ckl_config",
  sociedades: "ckl_sociedades",
  hoteles: "ckl_hoteles",
  origenes: "ckl_origenes",
  resetCodes: "ckl_reset_codes",
  session: "ckl_session",
} as const;

// ───────── SEED DATA ─────────
const SEED_ROLES: Role[] = [
  {
    id: 1, nombre: "usuario",
    permisos: {
      solicitar: true, ver_propio: true, comprobar: true,
      ver_equipo: false, ver_todo: false,
      autorizar_lte5000: false, autorizar_gt5000: false,
      rechazar: false, subir_comprobantes_viaje: false,
      ver_reportes: false, exportar_reportes: false,
      gestionar_usuarios: false, configurar_permisos: false, configurar_montos: false,
    },
  },
  {
    id: 2, nombre: "jefe_inmediato",
    permisos: {
      solicitar: true, ver_propio: true, comprobar: false,
      ver_equipo: true, ver_todo: false,
      autorizar_lte5000: true, autorizar_gt5000: false,
      rechazar: true, subir_comprobantes_viaje: false,
      ver_reportes: true, exportar_reportes: false,
      gestionar_usuarios: false, configurar_permisos: false, configurar_montos: false,
    },
  },
  {
    id: 3, nombre: "gestor_vuelos",
    permisos: {
      solicitar: false, ver_propio: false, comprobar: false,
      ver_equipo: false, ver_todo: true,
      autorizar_lte5000: false, autorizar_gt5000: false,
      rechazar: false, subir_comprobantes_viaje: true,
      ver_reportes: false, exportar_reportes: false,
      gestionar_usuarios: false, configurar_permisos: false, configurar_montos: false,
    },
  },
  {
    id: 4, nombre: "finanzas",
    permisos: {
      solicitar: true, ver_propio: true, comprobar: false,
      ver_equipo: false, ver_todo: true,
      autorizar_lte5000: false, autorizar_gt5000: true,
      rechazar: true, subir_comprobantes_viaje: false,
      ver_reportes: true, exportar_reportes: true,
      gestionar_usuarios: false, configurar_permisos: false, configurar_montos: false,
    },
  },
  {
    id: 5, nombre: "administrador",
    permisos: {
      solicitar: true, ver_propio: true, comprobar: true,
      ver_equipo: true, ver_todo: true,
      autorizar_lte5000: true, autorizar_gt5000: true,
      rechazar: true, subir_comprobantes_viaje: true,
      ver_reportes: true, exportar_reportes: true,
      gestionar_usuarios: true, configurar_permisos: true, configurar_montos: true,
    },
  },
  {
    // Mismos permisos que finanzas.
    id: 6, nombre: "compras_corporativas",
    permisos: {
      solicitar: true, ver_propio: true, comprobar: false,
      ver_equipo: false, ver_todo: true,
      autorizar_lte5000: false, autorizar_gt5000: true,
      rechazar: true, subir_comprobantes_viaje: false,
      ver_reportes: true, exportar_reportes: true,
      gestionar_usuarios: false, configurar_permisos: false, configurar_montos: false,
    },
  },
];

const SEED_USERS: User[] = [
  { id: "u1", nombre: "Alonso Pérez", correo: "admin@cklass.com", password: "Admin123!", rfc: "PEAL800101AB1", rol_id: 5, empresa: "WATA GROUP", jefe_id: null, activo: true, initials: "AP" },
  { id: "u2", nombre: "Juan Alvarado", correo: "jefe@cklass.com", password: "Jefe123!", rfc: "ALAJ750505CD2", rol_id: 2, empresa: "INTERMEDIARIA INTERMEX", jefe_id: "u1", activo: true, initials: "JA" },
  { id: "u3", nombre: "María Torres", correo: "usuario@cklass.com", password: "User123!", rfc: "TOMM900312EF3", rol_id: 1, empresa: "WATA GROUP", jefe_id: "u2", activo: true, initials: "MT" },
  { id: "u4", nombre: "Luis Vega", correo: "finanzas@cklass.com", password: "Fin123!", rfc: "VEGAL850620GH4", rol_id: 4, empresa: "WATA GROUP", jefe_id: "u1", activo: true, initials: "LV" },
  { id: "u5", nombre: "Patricia Luna", correo: "gestor@cklass.com", password: "Gest123!", rfc: "LUMP920718IJ5", rol_id: 3, empresa: "INTERMEDIARIA INTERMEX", jefe_id: "u1", activo: true, initials: "PL" },
  { id: "u6", nombre: "Diego Ramírez", correo: "compras@cklass.com", password: "Compras123!", rfc: "RADI870415KL7", rol_id: 6, empresa: "WATA GROUP", jefe_id: "u1", activo: true, initials: "DR" },
  // Empleados de ejemplo en las otras dos sociedades (WATA GROUP ya cubierta
  // por María Torres), para poder probar el flujo completo con cada RFC/Cédula
  // Fiscal distinta.
  { id: "u7", nombre: "Carlos Mendoza", correo: "usuario2@cklass.com", password: "User223!", rfc: "MECA880215MN8", rol_id: 1, empresa: "INTERMEDIARIA INTERMEX", jefe_id: "u2", activo: true, initials: "CM" },
  { id: "u8", nombre: "Sofía Ramírez", correo: "usuario3@cklass.com", password: "User323!", rfc: "RASO910822PQ4", rol_id: 1, empresa: "TRANSPORTES DE PERSONAL Y MERCANCIA", jefe_id: "u2", activo: true, initials: "SR" },
];

const SEED_SOCIEDADES: Sociedad[] = [
  { id: 1, nombre: "WATA GROUP", rfc: "WGR920403GN2", regimen: "601 - Gral. Personas Morales", cp: "83000", UsoCFDI: "Gastos en General", sociedad_sap: "2000" },
  { id: 2, nombre: "INTERMEDIARIA INTERMEX", rfc: "CCO010101AB3", regimen: "601 - Gral. Personas Morales", cp: "44100", UsoCFDI: "Gastos en General", sociedad_sap: "3000" },
  { id: 3, nombre: "TRANSPORTES DE PERSONAL Y MERCANCIA", rfc: "DCK150601XY1", regimen: "601 - Gral. Personas Morales", cp: "44600", UsoCFDI: "Gastos en General", sociedad_sap: "5000" },
];

const SEED_HOTELES: Hotel[] = [
  { id: 1, nombre: "Hotel Hilton GDL", ciudad: "Guadalajara", estado: "Jalisco", tarifa_base: 1250, activo: true },
  { id: 2, nombre: "Camino Real Guadalajara", ciudad: "Guadalajara", estado: "Jalisco", tarifa_base: 980, activo: true },
  { id: 3, nombre: "Holiday Inn Express GDL", ciudad: "Guadalajara", estado: "Jalisco", tarifa_base: 720, activo: true },
  { id: 4, nombre: "Hotel Krystal Urban GDL", ciudad: "Guadalajara", estado: "Jalisco", tarifa_base: 850, activo: true },
  { id: 5, nombre: "City Express Guadalajara", ciudad: "Guadalajara", estado: "Jalisco", tarifa_base: 590, activo: true },
  { id: 6, nombre: "JW Marriott CDMX", ciudad: "Ciudad de México", estado: "CDMX", tarifa_base: 2100, activo: true },
  { id: 7, nombre: "Presidente Intercontinental", ciudad: "Ciudad de México", estado: "CDMX", tarifa_base: 1850, activo: true },
  { id: 8, nombre: "Four Seasons México", ciudad: "Ciudad de México", estado: "CDMX", tarifa_base: 3200, activo: true },
  { id: 9, nombre: "Hotel Geneve CDMX", ciudad: "Ciudad de México", estado: "CDMX", tarifa_base: 1100, activo: true },
  { id: 10, nombre: "City Express Sur CDMX", ciudad: "Ciudad de México", estado: "CDMX", tarifa_base: 680, activo: true },
  { id: 11, nombre: "Hotel Hilton León", ciudad: "León", estado: "Guanajuato", tarifa_base: 1050, activo: true },
  { id: 12, nombre: "Hotel One León Norte", ciudad: "León", estado: "Guanajuato", tarifa_base: 620, activo: true },
  { id: 13, nombre: "Holiday Inn León", ciudad: "León", estado: "Guanajuato", tarifa_base: 880, activo: true },
  { id: 14, nombre: "Fiesta Inn León", ciudad: "León", estado: "Guanajuato", tarifa_base: 790, activo: true },
  { id: 15, nombre: "Fiesta Inn Monterrey", ciudad: "Monterrey", estado: "Nuevo León", tarifa_base: 950, activo: true },
  { id: 16, nombre: "NH Monterrey Centro", ciudad: "Monterrey", estado: "Nuevo León", tarifa_base: 1150, activo: true },
  { id: 17, nombre: "Camino Real Monterrey", ciudad: "Monterrey", estado: "Nuevo León", tarifa_base: 1380, activo: true },
  { id: 18, nombre: "City Express Monterrey", ciudad: "Monterrey", estado: "Nuevo León", tarifa_base: 640, activo: true },
  { id: 19, nombre: "Radisson Querétaro", ciudad: "Querétaro", estado: "Querétaro", tarifa_base: 870, activo: true },
  { id: 20, nombre: "Fiesta Inn QRO Centro", ciudad: "Querétaro", estado: "Querétaro", tarifa_base: 760, activo: true },
  { id: 21, nombre: "Exe Querétaro", ciudad: "Querétaro", estado: "Querétaro", tarifa_base: 580, activo: true },
  { id: 22, nombre: "Holiday Inn Querétaro", ciudad: "Querétaro", estado: "Querétaro", tarifa_base: 920, activo: true },
  { id: 23, nombre: "Hotel Ceballos Colima", ciudad: "Colima", estado: "Colima", tarifa_base: 550, activo: true },
  { id: 24, nombre: "Flamingos Plaza Colima", ciudad: "Colima", estado: "Colima", tarifa_base: 480, activo: true },
  { id: 25, nombre: "Quinta Real Zacatecas", ciudad: "Zacatecas", estado: "Zacatecas", tarifa_base: 1600, activo: true },
  { id: 26, nombre: "Emporio Zacatecas", ciudad: "Zacatecas", estado: "Zacatecas", tarifa_base: 890, activo: true },
  { id: 27, nombre: "City Express Zacatecas", ciudad: "Zacatecas", estado: "Zacatecas", tarifa_base: 560, activo: true },
  { id: 28, nombre: "Sheraton Buganvilias PVR", ciudad: "Puerto Vallarta", estado: "Jalisco", tarifa_base: 1750, activo: true },
  { id: 29, nombre: "Marriott Puerto Vallarta", ciudad: "Puerto Vallarta", estado: "Jalisco", tarifa_base: 2050, activo: true },
  { id: 30, nombre: "Fiesta Americana PVR", ciudad: "Puerto Vallarta", estado: "Jalisco", tarifa_base: 1420, activo: true },
];

const SEED_SOLICITUDES: Solicitud[] = [
  { id: "s1", folio: "#0041", user_id: "u3", fecha: "20/05/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - León - QRO", tipo_viaje: "Comercial", motivo: "Visita a distribuidores zona Bajío", personas_count: 2, personas_nombres: "M. Torres, J. Ruiz", monto_total: 8050, jefe_status: "Pendiente", finanzas_status: "Pendiente", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-05-20" },
  { id: "s2", folio: "#0040", user_id: "u3", fecha: "14/05/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - CDMX", tipo_viaje: "Auditoría", motivo: "Revisión de estados financieros Q1", personas_count: 1, personas_nombres: "M. Torres", monto_total: 5200, jefe_status: "Autorizado", finanzas_status: "Autorizado", estatus: "Cerrado", comprobante_viaje: "18/05/2026", created_at: "2026-05-14" },
  { id: "s3", folio: "#0039", user_id: "u3", fecha: "02/05/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - Colima", tipo_viaje: "Visita a tiendas", motivo: "Supervisión apertura nueva tienda Colima", personas_count: 1, personas_nombres: "M. Torres", monto_total: 2500, jefe_status: "Autorizado", finanzas_status: "Rechazado", estatus: "Rechazado", comprobante_viaje: null, nota_rechazo: "Monto de hotel no corresponde a tarifa acordada.", created_at: "2026-05-02" },
  { id: "s4", folio: "#0038", user_id: "u2", fecha: "25/04/2026", empresa: "INTERMEDIARIA INTERMEX", origen: "Guadalajara", destino_resumen: "GDL - Zacatecas", tipo_viaje: "Capacitación", motivo: "Capacitación equipo de ventas regional", personas_count: 3, personas_nombres: "J. Alvarado, P. Salas, R. Mora", monto_total: 10000, jefe_status: "Autorizado", finanzas_status: "Autorizado", estatus: "Cerrado", comprobante_viaje: "29/04/2026", created_at: "2026-04-25" },
  { id: "s5", folio: "#0037", user_id: "u3", fecha: "10/04/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - Monterrey", tipo_viaje: "Comercial", motivo: "Reunión con clientes clave zona norte", personas_count: 2, personas_nombres: "M. Torres, C. Ibarra", monto_total: 4800, jefe_status: "Pendiente", finanzas_status: "N/A", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-04-10" },
  { id: "s6", folio: "#0036", user_id: "u4", fecha: "01/04/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - Querétaro", tipo_viaje: "Auditoría", motivo: "Cierre de auditoría fiscal anual", personas_count: 1, personas_nombres: "L. Vega", monto_total: 3100, jefe_status: "Autorizado", finanzas_status: "N/A", estatus: "Cerrado", comprobante_viaje: "05/04/2026", created_at: "2026-04-01" },
  { id: "s7", folio: "#0042", user_id: "u3", fecha: "20/08/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - Monterrey", tipo_viaje: "Comercial", motivo: "Reunión con distribuidores zona norte", personas_count: 1, personas_nombres: "M. Torres", monto_total: 7200, jefe_status: "Pendiente", finanzas_status: "Pendiente", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-08-20" },
  { id: "s8", folio: "#0043", user_id: "u2", fecha: "25/08/2026", empresa: "INTERMEDIARIA INTERMEX", origen: "Guadalajara", destino_resumen: "GDL - Colima", tipo_viaje: "Visita a tiendas", motivo: "Supervisión de apertura de tienda nueva", personas_count: 1, personas_nombres: "J. Alvarado", monto_total: 3200, jefe_status: "Pendiente", finanzas_status: "N/A", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-08-25" },
  { id: "s9", folio: "#0044", user_id: "u6", fecha: "28/08/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - CDMX", tipo_viaje: "Visita a proveedores", motivo: "Negociación con proveedor nuevo", personas_count: 1, personas_nombres: "D. Ramírez", monto_total: 6100, jefe_status: "Pendiente", finanzas_status: "Pendiente", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-08-28" },
  { id: "s10", folio: "#0045", user_id: "u3", fecha: "01/09/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - Querétaro", tipo_viaje: "Capacitación", motivo: "Capacitación de equipo comercial", personas_count: 1, personas_nombres: "M. Torres", monto_total: 4500, jefe_status: "Autorizado", finanzas_status: "N/A", estatus: "Cerrado", comprobante_viaje: null, created_at: "2026-09-01" },
  { id: "s11", folio: "#0046", user_id: "u3", fecha: "03/09/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL - Colima", tipo_viaje: "Comercial", motivo: "Visita a cliente potencial", personas_count: 1, personas_nombres: "M. Torres", monto_total: 2100, jefe_status: "Rechazado", finanzas_status: "N/A", estatus: "Rechazado", comprobante_viaje: null, nota_rechazo: "Motivo de viaje insuficientemente justificado.", created_at: "2026-09-03" },
  // Carlos Mendoza (INTERMEDIARIA INTERMEX): una pendiente de autorizar y una ya comprobada.
  { id: "s12", folio: "#0047", user_id: "u7", fecha: "10/09/2026", empresa: "INTERMEDIARIA INTERMEX", origen: "Guadalajara", destino_resumen: "GDL - Zacatecas", tipo_viaje: "Visita a proveedores", motivo: "Revisión de flotilla en punto de distribución Zacatecas", personas_count: 1, personas_nombres: "C. Mendoza", monto_total: 6400, jefe_status: "Pendiente", finanzas_status: "Pendiente", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-09-10" },
  { id: "s13", folio: "#0048", user_id: "u7", fecha: "05/09/2026", empresa: "INTERMEDIARIA INTERMEX", origen: "Guadalajara", destino_resumen: "GDL - CDMX", tipo_viaje: "Auditoría", motivo: "Revisión de cumplimiento normativo trimestral", personas_count: 1, personas_nombres: "C. Mendoza", monto_total: 4200, jefe_status: "Autorizado", finanzas_status: "N/A", estatus: "Cerrado", comprobante_viaje: "18/09/2026", created_at: "2026-09-05" },
  // Sofía Ramírez (TRANSPORTES DE PERSONAL Y MERCANCIA): una pendiente y una ya cerrada.
  { id: "s14", folio: "#0049", user_id: "u8", fecha: "12/09/2026", empresa: "TRANSPORTES DE PERSONAL Y MERCANCIA", origen: "Guadalajara", destino_resumen: "GDL - Monterrey", tipo_viaje: "Comercial", motivo: "Negociación de contrato con cliente transportista", personas_count: 1, personas_nombres: "S. Ramírez", monto_total: 5800, jefe_status: "Pendiente", finanzas_status: "Pendiente", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-09-12" },
  { id: "s15", folio: "#0050", user_id: "u8", fecha: "14/09/2026", empresa: "TRANSPORTES DE PERSONAL Y MERCANCIA", origen: "Guadalajara", destino_resumen: "GDL - Querétaro", tipo_viaje: "Visita a tiendas", motivo: "Supervisión de operación logística en centro de distribución", personas_count: 1, personas_nombres: "S. Ramírez", monto_total: 3100, jefe_status: "Autorizado", finanzas_status: "N/A", estatus: "Cerrado", comprobante_viaje: "21/09/2026", created_at: "2026-09-14" },
];

const SEED_AUTORIZACIONES: Autorizacion[] = [
  { id: "a1", solicitud_id: "s2", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-05-15", nota: "" },
  { id: "a2", solicitud_id: "s2", rol_autorizador: "finanzas", user_id: "u4", status: "autorizado", fecha: "2026-05-16", nota: "" },
  { id: "a3", solicitud_id: "s3", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-05-03", nota: "" },
  { id: "a4", solicitud_id: "s3", rol_autorizador: "finanzas", user_id: "u4", status: "rechazado", fecha: "2026-05-04", nota: "Monto de hotel no corresponde a tarifa acordada." },
  { id: "a5", solicitud_id: "s4", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-04-26", nota: "" },
  { id: "a6", solicitud_id: "s4", rol_autorizador: "finanzas", user_id: "u4", status: "autorizado", fecha: "2026-04-27", nota: "" },
  { id: "a7", solicitud_id: "s6", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-04-02", nota: "" },
  { id: "a8", solicitud_id: "s10", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-09-02", nota: "" },
  { id: "a9", solicitud_id: "s11", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "rechazado", fecha: "2026-09-04", nota: "Motivo de viaje insuficientemente justificado." },
  { id: "a10", solicitud_id: "s13", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-09-06", nota: "" },
  { id: "a11", solicitud_id: "s15", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-09-15", nota: "" },
];

const SEED_COMPROBANTES: ComprobanteGasto[] = [
  { id: "cg1", solicitud_id: "s2", concepto: "Hotel", monto_solicitado: 1600, monto_comprobado: 1600, status_renglon: "comprobado" },
  { id: "cg2", solicitud_id: "s2", concepto: "Transporte foráneo", monto_solicitado: 1800, monto_comprobado: 1800, status_renglon: "comprobado" },
  { id: "cg3", solicitud_id: "s2", concepto: "Transporte local", monto_solicitado: 400, monto_comprobado: 200, status_renglon: "parcialmente_comprobado" },
  { id: "cg4", solicitud_id: "s2", concepto: "Comida", monto_solicitado: 900, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cg5", solicitud_id: "s2", concepto: "Otros", monto_solicitado: 500, monto_comprobado: 500, status_renglon: "comprobado" },
  { id: "cg6", solicitud_id: "s10", concepto: "Hotel", monto_solicitado: 1600, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cg7", solicitud_id: "s10", concepto: "Transporte foráneo", monto_solicitado: 1400, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cg8", solicitud_id: "s10", concepto: "Transporte local", monto_solicitado: 300, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cg9", solicitud_id: "s10", concepto: "Comida", monto_solicitado: 900, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cg10", solicitud_id: "s10", concepto: "Otros", monto_solicitado: 300, monto_comprobado: 0, status_renglon: "pendiente" },
];

// Desglose (hoteles, transportes, otros conceptos) por destino de cada
// solicitud sembrada, en el mismo formato que guarda "Solicitar viáticos" en
// KEYS.destinos — permite que quien autoriza (Jefe/Finanzas/Compras) vea el
// detalle completo en Estatus, no solo el monto total. s2 y s10 ya tenían su
// desglose de montos en SEED_COMPROBANTES (cg1-cg5 y cg6-cg10): aquí se les da
// un Destino cuyos montos cuadran con esos renglones ya existentes.
const SEED_DESTINOS_DETALLE = [
  {
    id: "dd_s1", solicitud_id: "s1", estado: "Guanajuato",
    fecha_inicio: "2026-05-23", fecha_fin: "2026-05-28",
    hoteles: [{ id: "hh_s1", fecha_inicio: "2026-05-23", fecha_fin: "2026-05-28", monto: 620, manual: false }],
    foraneo: [{ id: "rf_s1", tipo: "Autobús", monto: 2254 }],
    local: [{ id: "rl_s1", tipo: "Uber", monto: 773 }],
    otros: [{ id: "ro_s1", concepto: "Imprevistos", monto: 313 }],
  },
  {
    id: "dd_s2", solicitud_id: "s2", estado: "CDMX",
    fecha_inicio: "2026-05-17", fecha_fin: "2026-05-19",
    hoteles: [{ id: "hh_s2", fecha_inicio: "2026-05-17", fecha_fin: "2026-05-19", monto: 1600, manual: true }],
    foraneo: [{ id: "rf_s2", tipo: "Avión", monto: 1800 }],
    local: [{ id: "rl_s2", tipo: "Uber", monto: 400 }],
    otros: [{ id: "ro_s2", concepto: "Regalos para cliente", monto: 500 }],
  },
  {
    // Monto manual de hotel notablemente por encima de la tarifa de catálogo
    // en Colima (~$480-550): consistente con la nota de rechazo de este folio
    // ("Monto de hotel no corresponde a tarifa acordada").
    id: "dd_s3", solicitud_id: "s3", estado: "Colima",
    fecha_inicio: "2026-05-05", fecha_fin: "2026-05-07",
    hoteles: [{ id: "hh_s3", fecha_inicio: "2026-05-05", fecha_fin: "2026-05-07", monto: 1200, manual: true }],
    foraneo: [{ id: "rf_s3", tipo: "Autobús", monto: 500 }],
    local: [{ id: "rl_s3", tipo: "Uber", monto: 200 }],
    otros: [{ id: "ro_s3", concepto: "Imprevistos", monto: 100 }],
  },
  {
    id: "dd_s4", solicitud_id: "s4", estado: "Zacatecas",
    fecha_inicio: "2026-04-28", fecha_fin: "2026-05-02",
    hoteles: [{ id: "hh_s4", fecha_inicio: "2026-04-28", fecha_fin: "2026-05-02", monto: 890, manual: false }],
    foraneo: [{ id: "rf_s4", tipo: "Autobús", monto: 2800 }],
    local: [{ id: "rl_s4", tipo: "Uber", monto: 960 }],
    otros: [{ id: "ro_s4", concepto: "Material de capacitación", monto: 680 }],
  },
  {
    id: "dd_s5", solicitud_id: "s5", estado: "Nuevo León",
    fecha_inicio: "2026-04-13", fecha_fin: "2026-04-15",
    hoteles: [{ id: "hh_s5", fecha_inicio: "2026-04-13", fecha_fin: "2026-04-15", monto: 950, manual: false }],
    foraneo: [{ id: "rf_s5", tipo: "Avión", monto: 1344 }],
    local: [{ id: "rl_s5", tipo: "Uber", monto: 461 }],
    otros: [{ id: "ro_s5", concepto: "Imprevistos", monto: 135 }],
  },
  {
    id: "dd_s6", solicitud_id: "s6", estado: "Querétaro",
    fecha_inicio: "2026-04-04", fecha_fin: "2026-04-05",
    hoteles: [{ id: "hh_s6", fecha_inicio: "2026-04-04", fecha_fin: "2026-04-05", monto: 760, manual: false }],
    foraneo: [{ id: "rf_s6", tipo: "Autobús", monto: 868 }],
    local: [{ id: "rl_s6", tipo: "Uber", monto: 298 }],
    otros: [{ id: "ro_s6", concepto: "Papelería", monto: 554 }],
  },
  {
    id: "dd_s7", solicitud_id: "s7", estado: "Nuevo León",
    fecha_inicio: "2026-08-23", fecha_fin: "2026-08-26",
    hoteles: [{ id: "hh_s7", fecha_inicio: "2026-08-23", fecha_fin: "2026-08-26", monto: 950, manual: false }],
    foraneo: [{ id: "rf_s7", tipo: "Avión", monto: 2016 }],
    local: [{ id: "rl_s7", tipo: "Uber", monto: 691 }],
    otros: [{ id: "ro_s7", concepto: "Imprevistos", monto: 203 }],
  },
  {
    id: "dd_s8", solicitud_id: "s8", estado: "Colima",
    fecha_inicio: "2026-08-28", fecha_fin: "2026-08-30",
    hoteles: [{ id: "hh_s8", fecha_inicio: "2026-08-28", fecha_fin: "2026-08-30", monto: 550, manual: false }],
    foraneo: [{ id: "rf_s8", tipo: "Autobús", monto: 896 }],
    local: [{ id: "rl_s8", tipo: "Uber", monto: 307 }],
    otros: [{ id: "ro_s8", concepto: "Imprevistos", monto: 257 }],
  },
  {
    id: "dd_s9", solicitud_id: "s9", estado: "CDMX",
    fecha_inicio: "2026-08-31", fecha_fin: "2026-09-02",
    hoteles: [{ id: "hh_s9", fecha_inicio: "2026-08-31", fecha_fin: "2026-09-02", monto: 1100, manual: false }],
    foraneo: [{ id: "rf_s9", tipo: "Avión", monto: 1708 }],
    local: [{ id: "rl_s9", tipo: "Uber", monto: 586 }],
    otros: [{ id: "ro_s9", concepto: "Muestras de producto", monto: 386 }],
  },
  {
    id: "dd_s10", solicitud_id: "s10", estado: "Querétaro",
    fecha_inicio: "2026-09-04", fecha_fin: "2026-09-06",
    hoteles: [{ id: "hh_s10", fecha_inicio: "2026-09-04", fecha_fin: "2026-09-06", monto: 1600, manual: true }],
    foraneo: [{ id: "rf_s10", tipo: "Autobús", monto: 1400 }],
    local: [{ id: "rl_s10", tipo: "Uber", monto: 300 }],
    otros: [{ id: "ro_s10", concepto: "Material de capacitación", monto: 300 }],
  },
  {
    id: "dd_s11", solicitud_id: "s11", estado: "Colima",
    fecha_inicio: "2026-09-06", fecha_fin: "2026-09-07",
    hoteles: [{ id: "hh_s11", fecha_inicio: "2026-09-06", fecha_fin: "2026-09-07", monto: 550, manual: false }],
    foraneo: [{ id: "rf_s11", tipo: "Autobús", monto: 588 }],
    local: [{ id: "rl_s11", tipo: "Uber", monto: 202 }],
    otros: [{ id: "ro_s11", concepto: "Imprevistos", monto: 340 }],
  },
  {
    id: "dd_s12", solicitud_id: "s12", estado: "Zacatecas",
    fecha_inicio: "2026-09-13", fecha_fin: "2026-09-16",
    hoteles: [{ id: "hh_s12", fecha_inicio: "2026-09-13", fecha_fin: "2026-09-16", monto: 890, manual: false }],
    foraneo: [{ id: "rf_s12", tipo: "Autobús", monto: 1792 }],
    local: [{ id: "rl_s12", tipo: "Uber", monto: 614 }],
    otros: [{ id: "ro_s12", concepto: "Imprevistos", monto: 44 }],
  },
  {
    id: "dd_s13", solicitud_id: "s13", estado: "CDMX",
    fecha_inicio: "2026-09-08", fecha_fin: "2026-09-09",
    hoteles: [{ id: "hh_s13", fecha_inicio: "2026-09-08", fecha_fin: "2026-09-09", monto: 1100, manual: false }],
    foraneo: [{ id: "rf_s13", tipo: "Avión", monto: 1176 }],
    local: [{ id: "rl_s13", tipo: "Uber", monto: 403 }],
    otros: [{ id: "ro_s13", concepto: "Papelería", monto: 681 }],
  },
  {
    id: "dd_s14", solicitud_id: "s14", estado: "Nuevo León",
    fecha_inicio: "2026-09-15", fecha_fin: "2026-09-17",
    hoteles: [{ id: "hh_s14", fecha_inicio: "2026-09-15", fecha_fin: "2026-09-17", monto: 950, manual: false }],
    foraneo: [{ id: "rf_s14", tipo: "Avión", monto: 1624 }],
    local: [{ id: "rl_s14", tipo: "Uber", monto: 557 }],
    otros: [{ id: "ro_s14", concepto: "Imprevistos", monto: 559 }],
  },
  {
    id: "dd_s15", solicitud_id: "s15", estado: "Querétaro",
    fecha_inicio: "2026-09-17", fecha_fin: "2026-09-18",
    hoteles: [{ id: "hh_s15", fecha_inicio: "2026-09-17", fecha_fin: "2026-09-18", monto: 870, manual: false }],
    foraneo: [{ id: "rf_s15", tipo: "Autobús", monto: 868 }],
    local: [{ id: "rl_s15", tipo: "Uber", monto: 298 }],
    otros: [{ id: "ro_s15", concepto: "Imprevistos", monto: 444 }],
  },
];

// Renglones de comprobación para las solicitudes sembradas que aún no tenían
// (s2 y s10 ya venían en SEED_COMPROBANTES); mismos montos que sus Destino en
// SEED_DESTINOS_DETALLE para que "Resumen de montos" en Estatus cuadre.
const SEED_COMPROBANTES_DETALLE: ComprobanteGasto[] = [
  { id: "cgd_s1_1", solicitud_id: "s1", concepto: "Hotel", monto_solicitado: 3100, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s1_2", solicitud_id: "s1", concepto: "Transporte foráneo", monto_solicitado: 2254, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s1_3", solicitud_id: "s1", concepto: "Transporte local", monto_solicitado: 773, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s1_4", solicitud_id: "s1", concepto: "Comida", monto_solicitado: 1610, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s1_5", solicitud_id: "s1", concepto: "Otros", monto_solicitado: 313, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s3_1", solicitud_id: "s3", concepto: "Hotel", monto_solicitado: 1200, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s3_2", solicitud_id: "s3", concepto: "Transporte foráneo", monto_solicitado: 500, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s3_3", solicitud_id: "s3", concepto: "Transporte local", monto_solicitado: 200, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s3_4", solicitud_id: "s3", concepto: "Comida", monto_solicitado: 500, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s3_5", solicitud_id: "s3", concepto: "Otros", monto_solicitado: 100, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s4_1", solicitud_id: "s4", concepto: "Hotel", monto_solicitado: 3560, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s4_2", solicitud_id: "s4", concepto: "Transporte foráneo", monto_solicitado: 2800, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s4_3", solicitud_id: "s4", concepto: "Transporte local", monto_solicitado: 960, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s4_4", solicitud_id: "s4", concepto: "Comida", monto_solicitado: 2000, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s4_5", solicitud_id: "s4", concepto: "Otros", monto_solicitado: 680, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s5_1", solicitud_id: "s5", concepto: "Hotel", monto_solicitado: 1900, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s5_2", solicitud_id: "s5", concepto: "Transporte foráneo", monto_solicitado: 1344, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s5_3", solicitud_id: "s5", concepto: "Transporte local", monto_solicitado: 461, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s5_4", solicitud_id: "s5", concepto: "Comida", monto_solicitado: 960, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s5_5", solicitud_id: "s5", concepto: "Otros", monto_solicitado: 135, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s6_1", solicitud_id: "s6", concepto: "Hotel", monto_solicitado: 760, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s6_2", solicitud_id: "s6", concepto: "Transporte foráneo", monto_solicitado: 868, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s6_3", solicitud_id: "s6", concepto: "Transporte local", monto_solicitado: 298, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s6_4", solicitud_id: "s6", concepto: "Comida", monto_solicitado: 620, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s6_5", solicitud_id: "s6", concepto: "Otros", monto_solicitado: 554, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s7_1", solicitud_id: "s7", concepto: "Hotel", monto_solicitado: 2850, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s7_2", solicitud_id: "s7", concepto: "Transporte foráneo", monto_solicitado: 2016, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s7_3", solicitud_id: "s7", concepto: "Transporte local", monto_solicitado: 691, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s7_4", solicitud_id: "s7", concepto: "Comida", monto_solicitado: 1440, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s7_5", solicitud_id: "s7", concepto: "Otros", monto_solicitado: 203, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s8_1", solicitud_id: "s8", concepto: "Hotel", monto_solicitado: 1100, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s8_2", solicitud_id: "s8", concepto: "Transporte foráneo", monto_solicitado: 896, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s8_3", solicitud_id: "s8", concepto: "Transporte local", monto_solicitado: 307, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s8_4", solicitud_id: "s8", concepto: "Comida", monto_solicitado: 640, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s8_5", solicitud_id: "s8", concepto: "Otros", monto_solicitado: 257, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s9_1", solicitud_id: "s9", concepto: "Hotel", monto_solicitado: 2200, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s9_2", solicitud_id: "s9", concepto: "Transporte foráneo", monto_solicitado: 1708, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s9_3", solicitud_id: "s9", concepto: "Transporte local", monto_solicitado: 586, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s9_4", solicitud_id: "s9", concepto: "Comida", monto_solicitado: 1220, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s9_5", solicitud_id: "s9", concepto: "Otros", monto_solicitado: 386, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s11_1", solicitud_id: "s11", concepto: "Hotel", monto_solicitado: 550, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s11_2", solicitud_id: "s11", concepto: "Transporte foráneo", monto_solicitado: 588, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s11_3", solicitud_id: "s11", concepto: "Transporte local", monto_solicitado: 202, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s11_4", solicitud_id: "s11", concepto: "Comida", monto_solicitado: 420, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s11_5", solicitud_id: "s11", concepto: "Otros", monto_solicitado: 340, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s12_1", solicitud_id: "s12", concepto: "Hotel", monto_solicitado: 2670, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s12_2", solicitud_id: "s12", concepto: "Transporte foráneo", monto_solicitado: 1792, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s12_3", solicitud_id: "s12", concepto: "Transporte local", monto_solicitado: 614, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s12_4", solicitud_id: "s12", concepto: "Comida", monto_solicitado: 1280, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s12_5", solicitud_id: "s12", concepto: "Otros", monto_solicitado: 44, monto_comprobado: 0, status_renglon: "pendiente" },
  // s13 (#0048) ya fue comprobada por completo.
  { id: "cgd_s13_1", solicitud_id: "s13", concepto: "Hotel", monto_solicitado: 1100, monto_comprobado: 1100, status_renglon: "comprobado" },
  { id: "cgd_s13_2", solicitud_id: "s13", concepto: "Transporte foráneo", monto_solicitado: 1176, monto_comprobado: 1176, status_renglon: "comprobado" },
  { id: "cgd_s13_3", solicitud_id: "s13", concepto: "Transporte local", monto_solicitado: 403, monto_comprobado: 403, status_renglon: "comprobado" },
  { id: "cgd_s13_4", solicitud_id: "s13", concepto: "Comida", monto_solicitado: 840, monto_comprobado: 840, status_renglon: "comprobado" },
  { id: "cgd_s13_5", solicitud_id: "s13", concepto: "Otros", monto_solicitado: 681, monto_comprobado: 681, status_renglon: "comprobado" },
  { id: "cgd_s14_1", solicitud_id: "s14", concepto: "Hotel", monto_solicitado: 1900, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s14_2", solicitud_id: "s14", concepto: "Transporte foráneo", monto_solicitado: 1624, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s14_3", solicitud_id: "s14", concepto: "Transporte local", monto_solicitado: 557, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s14_4", solicitud_id: "s14", concepto: "Comida", monto_solicitado: 1160, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s14_5", solicitud_id: "s14", concepto: "Otros", monto_solicitado: 559, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s15_1", solicitud_id: "s15", concepto: "Hotel", monto_solicitado: 870, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s15_2", solicitud_id: "s15", concepto: "Transporte foráneo", monto_solicitado: 868, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s15_3", solicitud_id: "s15", concepto: "Transporte local", monto_solicitado: 298, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s15_4", solicitud_id: "s15", concepto: "Comida", monto_solicitado: 620, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cgd_s15_5", solicitud_id: "s15", concepto: "Otros", monto_solicitado: 444, monto_comprobado: 0, status_renglon: "pendiente" },
];

const SEED_CONFIG = {
  monto_comida_diario: 450,
  umbral_finanzas: 5000,
  dia_deposito: "Viernes",
  email_compras: "compras@cklass.com",
  dias_comprobacion_atrasada: 7,
  dias_autorizacion_pendiente: 3,
  dias_recordatorio_viaje: 2,
  notif_email_activo: true,
  notif_email_destinatarios: "",
  smtp_servidor: "",
  smtp_puerto: 587,
  smtp_usuario: "",
  smtp_password: "",
  smtp_cifrado: "TLS",
  notif_plataforma_activo: true,
  revision_automatica_activo: true,
};

const SEED_ORIGENES = ["Guadalajara", "Ciudad de México", "Monterrey", "León", "Querétaro"];

export function initSeed() {
  if (typeof window === "undefined") return;
  const seed: [string, unknown][] = [
    [KEYS.roles, SEED_ROLES],
    [KEYS.users, SEED_USERS],
    [KEYS.sociedades, SEED_SOCIEDADES],
    [KEYS.hoteles, SEED_HOTELES],
    [KEYS.solicitudes, SEED_SOLICITUDES],
    [KEYS.autorizaciones, SEED_AUTORIZACIONES],
    [KEYS.comprobantesGasto, SEED_COMPROBANTES],
    [KEYS.config, SEED_CONFIG],
    [KEYS.origenes, SEED_ORIGENES],
    [KEYS.resetCodes, []],
    [KEYS.prealtas, []],
    [KEYS.destinos, []],
    [KEYS.gastos, []],
    [KEYS.notas, []],
    [KEYS.comprobantesViaje, []],
    [KEYS.facturasXml, []],
  ];
  for (const [k, v] of seed) {
    if (window.localStorage.getItem(k) === null) {
      window.localStorage.setItem(k, JSON.stringify(v));
    }
  }
  backfillComprasCorporativas();
  backfillDemoBatch2026_09();
  backfillAutomationsConfig();
  backfillDestinoDetalle();
  backfillEmpleadosMultiSociedad();
}

// Empleados de ejemplo (rol "usuario") en las otras dos sociedades — antes
// solo WATA GROUP tenía un empleado con solicitudes de prueba. Se agregan
// aquí (no en SEED_USERS/SEED_SOLICITUDES a secas) para que también lleguen a
// navegadores que ya tenían datos sembrados.
function backfillEmpleadosMultiSociedad() {
  const users = lsGet<User[]>(KEYS.users, []);
  const faltanUsers = SEED_USERS.filter(
    (u) => ["u7", "u8"].includes(u.id) && !users.some((x) => x.id === u.id),
  );
  if (faltanUsers.length) lsSet(KEYS.users, [...users, ...faltanUsers]);

  const solicitudes = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  const idsNuevos = ["s12", "s13", "s14", "s15"];
  const faltanSolicitudes = SEED_SOLICITUDES.filter(
    (s) => idsNuevos.includes(s.id) && !solicitudes.some((x) => x.id === s.id),
  );
  if (faltanSolicitudes.length) lsSet(KEYS.solicitudes, [...faltanSolicitudes, ...solicitudes]);

  const autorizaciones = lsGet<Autorizacion[]>(KEYS.autorizaciones, []);
  const faltanAut = SEED_AUTORIZACIONES.filter(
    (a) => ["a10", "a11"].includes(a.id) && !autorizaciones.some((x) => x.id === a.id),
  );
  if (faltanAut.length) lsSet(KEYS.autorizaciones, [...autorizaciones, ...faltanAut]);
}

// Le da desglose (hoteles, transportes, otros conceptos) a las solicitudes
// sembradas que aún no lo tenían, para que "Estatus" pueda mostrárselo a quien
// autoriza. Idempotente: solo agrega lo que falte por solicitud_id/id.
function backfillDestinoDetalle() {
  const destinos = lsGet<{ solicitud_id: string }[]>(KEYS.destinos, []);
  const faltanDestinos = SEED_DESTINOS_DETALLE.filter(
    (d) => !destinos.some((x) => x.solicitud_id === d.solicitud_id),
  );
  if (faltanDestinos.length) lsSet(KEYS.destinos, [...destinos, ...faltanDestinos]);

  const comprobantes = lsGet<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
  const faltanComprobantes = SEED_COMPROBANTES_DETALLE.filter(
    (c) => !comprobantes.some((x) => x.id === c.id),
  );
  if (faltanComprobantes.length) lsSet(KEYS.comprobantesGasto, [...comprobantes, ...faltanComprobantes]);
}

// Navegadores que ya tenían ckl_config guardado antes de que existieran los
// campos de Automatizaciones (umbrales de días, correo, SMTP) no los reciben
// vía el seed normal (solo se siembra si la key está vacía) — se completan
// aquí sin tocar los valores que el usuario ya haya configurado.
function backfillAutomationsConfig() {
  const config = lsGet<Record<string, unknown>>(KEYS.config, {});
  const faltaAlguno = Object.keys(SEED_CONFIG).some((k) => !(k in config));
  if (faltaAlguno) lsSet(KEYS.config, { ...SEED_CONFIG, ...config });
}

// Los navegadores que ya tenían ckl_roles/ckl_users guardados antes de que
// este rol existiera no reciben el seed inicial (initSeed solo siembra si la
// key está vacía) — este backfill los pone al día sin tocar el resto de sus datos.
function backfillComprasCorporativas() {
  const roles = lsGet<Role[]>(KEYS.roles, []);
  let comprasRole = roles.find((r) => r.nombre === "compras_corporativas");
  if (!comprasRole) {
    const finanzas = roles.find((r) => r.nombre === "finanzas");
    const newId = Math.max(0, ...roles.map((r) => r.id)) + 1;
    comprasRole = { id: newId, nombre: "compras_corporativas", permisos: { ...(finanzas?.permisos ?? {}) } };
    lsSet(KEYS.roles, [...roles, comprasRole]);
  }

  const users = lsGet<User[]>(KEYS.users, []);
  if (!users.some((u) => u.correo === "compras@cklass.com")) {
    const admin = users.find((u) => u.correo === "admin@cklass.com");
    lsSet(KEYS.users, [
      ...users,
      {
        id: uid("u_"), nombre: "Diego Ramírez", correo: "compras@cklass.com",
        password: "Compras123!", rfc: "RADI870415KL7", rol_id: comprasRole.id,
        empresa: "WATA GROUP", jefe_id: admin?.id ?? null, activo: true, initials: "DR",
      },
    ]);
  }
}

// Solicitudes de ejemplo agregadas después de que los primeros folios (s1–s6)
// ya se comprobaron/cerraron en pruebas — sin este backfill, un navegador que
// ya tenía datos sembrados nunca las recibe (initSeed solo siembra si la key
// está vacía). También reactiva a Patricia Luna (gestor de vuelos), que en el
// seed original estaba inactiva.
function backfillDemoBatch2026_09() {
  const users = lsGet<User[]>(KEYS.users, []);
  // Los ids "u2"/"u3"/"u6" en SEED_SOLICITUDES asumen un seed fresco; en un
  // navegador donde Compras Corporativas se creó vía backfillComprasCorporativas
  // (id aleatorio), hay que remapear al id real por correo o el folio queda
  // huérfano (se ve "sin asignar" en la tabla de recientes del Dashboard).
  const idByCorreo = (correo: string) => users.find((u) => u.correo === correo)?.id;
  const realId: Record<string, string | undefined> = {
    u2: idByCorreo("jefe@cklass.com"),
    u3: idByCorreo("usuario@cklass.com"),
    u6: idByCorreo("compras@cklass.com"),
  };
  const remapUserId = (id: string) => realId[id] ?? id;

  const solicitudes = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  const idsNuevos = ["s7", "s8", "s9", "s10", "s11"];
  const faltantes = SEED_SOLICITUDES.filter(
    (s) => idsNuevos.includes(s.id) && !solicitudes.some((x) => x.id === s.id),
  ).map((s) => ({ ...s, user_id: remapUserId(s.user_id) }));

  if (faltantes.length) {
    lsSet(KEYS.solicitudes, [...faltantes, ...solicitudes]);

    const autorizaciones = lsGet<Autorizacion[]>(KEYS.autorizaciones, []);
    const autNuevas = SEED_AUTORIZACIONES.filter(
      (a) => ["a8", "a9"].includes(a.id) && !autorizaciones.some((x) => x.id === a.id),
    ).map((a) => ({ ...a, user_id: remapUserId(a.user_id) }));
    if (autNuevas.length) lsSet(KEYS.autorizaciones, [...autorizaciones, ...autNuevas]);

    const comprobantes = lsGet<ComprobanteGasto[]>(KEYS.comprobantesGasto, []);
    const cgNuevos = SEED_COMPROBANTES.filter(
      (c) => c.solicitud_id === "s10" && !comprobantes.some((x) => x.id === c.id),
    );
    if (cgNuevos.length) lsSet(KEYS.comprobantesGasto, [...comprobantes, ...cgNuevos]);
  }

  // Repara folios insertados por una corrida anterior de este backfill (antes del
  // remapeo de arriba) que quedaron con un user_id huérfano.
  const seedUserIdById: Record<string, string> = Object.fromEntries(
    SEED_SOLICITUDES.filter((s) => idsNuevos.includes(s.id)).map((s) => [s.id, s.user_id]),
  );
  const current = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  let repairedAny = false;
  const repaired = current.map((s) => {
    const seedUserId = seedUserIdById[s.id];
    if (!seedUserId) return s;
    const correctId = remapUserId(seedUserId);
    const isOrphan = !users.some((u) => u.id === s.user_id);
    if (correctId && isOrphan && s.user_id !== correctId) {
      repairedAny = true;
      return { ...s, user_id: correctId };
    }
    return s;
  });
  if (repairedAny) lsSet(KEYS.solicitudes, repaired);

  const gestor = users.find((u) => u.correo === "gestor@cklass.com");
  if (gestor && !gestor.activo) {
    lsSet(KEYS.users, users.map((u) => (u.id === gestor.id ? { ...u, activo: true } : u)));
  }
}

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export function nextFolio(): string {
  const list = lsGet<Solicitud[]>(KEYS.solicitudes, []);
  let max = 40;
  for (const s of list) {
    const n = parseInt(s.folio.replace("#", ""), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return "#" + String(max + 1).padStart(4, "0");
}

export function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("es-MX", { maximumFractionDigits: 0 });
}

export function findUserByIdentifier(identifier: string): User | undefined {
  const id = identifier.trim().toLowerCase();
  const users = lsGet<User[]>(KEYS.users, []);
  return users.find((u) => u.correo.toLowerCase() === id || u.rfc.toLowerCase() === id);
}

const RESET_CODE_TTL_MS = 10 * 60 * 1000;

// No hay servicio de correo real conectado: el código se genera y se guarda
// en localStorage; la UI lo muestra directamente a modo de "correo simulado".
export function generateResetCode(identifier: string): { user: User; code: string } | null {
  const user = findUserByIdentifier(identifier);
  if (!user || !user.activo) return null;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codes = lsGet<ResetCode[]>(KEYS.resetCodes, []);
  codes.push({ id: uid("rc_"), user_id: user.id, code, created_at: new Date().toISOString(), used: false });
  lsSet(KEYS.resetCodes, codes);
  return { user, code };
}

export function resetPasswordWithCode(identifier: string, code: string, newPassword: string): boolean {
  const user = findUserByIdentifier(identifier);
  if (!user) return false;
  const codes = lsGet<ResetCode[]>(KEYS.resetCodes, []);
  const match = codes.find(
    (c) =>
      c.user_id === user.id &&
      c.code === code.trim() &&
      !c.used &&
      Date.now() - new Date(c.created_at).getTime() <= RESET_CODE_TTL_MS,
  );
  if (!match) return false;
  match.used = true;
  lsSet(KEYS.resetCodes, codes);
  const users = lsGet<User[]>(KEYS.users, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx === -1) return false;
  users[idx] = { ...users[idx], password: newPassword };
  lsSet(KEYS.users, users);
  return true;
}

// Roles con visibilidad extendida (4 meses) de solicitudes en Estatus/Reportes;
// el resto de los roles se limita a 2 meses hacia atrás.
const EXTENDED_DATE_RANGE_ROLES = [
  "administrador",
  "finanzas",
  "compras_corporativas",
  "jefe_inmediato",
];

export function visibilityMonthsBack(roleName?: string): number {
  return roleName && EXTENDED_DATE_RANGE_ROLES.includes(roleName) ? 4 : 2;
}

export function filterSolicitudesByDateCutoff(solicitudes: Solicitud[], roleName?: string): Solicitud[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - visibilityMonthsBack(roleName));
  return solicitudes.filter((s) => new Date(s.created_at) >= cutoff);
}

// Alcance por rol: ver_todo ve todo, ver_equipo ve solo a su equipo (jefe_id === user.id),
// cualquier otro rol ve únicamente sus propias solicitudes.
export function filterSolicitudesByOwnership(
  user: User | null,
  role: Role | null,
  solicitudes: Solicitud[],
  users: User[],
): Solicitud[] {
  if (!user || !role) return [];
  if (role.permisos.ver_todo) return solicitudes;
  if (role.permisos.ver_equipo) {
    const teamIds = new Set(users.filter((u) => u.jefe_id === user.id).map((u) => u.id));
    return solicitudes.filter((s) => teamIds.has(s.user_id));
  }
  return solicitudes.filter((s) => s.user_id === user.id);
}
