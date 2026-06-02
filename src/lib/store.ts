// CKL Portal de Viáticos — centralized localStorage store

export type Role = {
  id: number;
  nombre: "usuario" | "jefe_inmediato" | "gestor_vuelos" | "finanzas" | "administrador";
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
];

const SEED_USERS: User[] = [
  { id: "u1", nombre: "Alonso Pérez", correo: "admin@cklass.com", password: "Admin123!", rfc: "PEAL800101AB1", rol_id: 5, empresa: "WATA GROUP", jefe_id: null, activo: true, initials: "AP" },
  { id: "u2", nombre: "Juan Alvarado", correo: "jefe@cklass.com", password: "Jefe123!", rfc: "ALAJ750505CD2", rol_id: 2, empresa: "INTERMEDIARIA INTERMEX", jefe_id: "u1", activo: true, initials: "JA" },
  { id: "u3", nombre: "María Torres", correo: "usuario@cklass.com", password: "User123!", rfc: "TOMM900312EF3", rol_id: 1, empresa: "WATA GROUP", jefe_id: "u2", activo: true, initials: "MT" },
  { id: "u4", nombre: "Luis Vega", correo: "finanzas@cklass.com", password: "Fin123!", rfc: "VEGAL850620GH4", rol_id: 4, empresa: "WATA GROUP", jefe_id: "u1", activo: true, initials: "LV" },
  { id: "u5", nombre: "Patricia Luna", correo: "gestor@cklass.com", password: "Gest123!", rfc: "LUMP920718IJ5", rol_id: 3, empresa: "INTERMEDIARIA INTERMEX", jefe_id: "u1", activo: false, initials: "PL" },
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
  { id: "s1", folio: "#0041", user_id: "u3", fecha: "20/05/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL → León → QRO", tipo_viaje: "Comercial", motivo: "Visita a distribuidores zona Bajío", personas_count: 2, personas_nombres: "M. Torres, J. Ruiz", monto_total: 8050, jefe_status: "Pendiente", finanzas_status: "Pendiente", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-05-20" },
  { id: "s2", folio: "#0040", user_id: "u3", fecha: "14/05/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL → CDMX", tipo_viaje: "Auditoría", motivo: "Revisión de estados financieros Q1", personas_count: 1, personas_nombres: "M. Torres", monto_total: 5200, jefe_status: "Autorizado", finanzas_status: "Autorizado", estatus: "Cerrado", comprobante_viaje: "18/05/2026", created_at: "2026-05-14" },
  { id: "s3", folio: "#0039", user_id: "u3", fecha: "02/05/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL → Colima", tipo_viaje: "Visita a tiendas", motivo: "Supervisión apertura nueva tienda Colima", personas_count: 1, personas_nombres: "M. Torres", monto_total: 2500, jefe_status: "Autorizado", finanzas_status: "Rechazado", estatus: "Rechazado", comprobante_viaje: null, nota_rechazo: "Monto de hotel no corresponde a tarifa acordada.", created_at: "2026-05-02" },
  { id: "s4", folio: "#0038", user_id: "u2", fecha: "25/04/2026", empresa: "INTERMEDIARIA INTERMEX", origen: "Guadalajara", destino_resumen: "GDL → Zacatecas", tipo_viaje: "Capacitación", motivo: "Capacitación equipo de ventas regional", personas_count: 3, personas_nombres: "J. Alvarado, P. Salas, R. Mora", monto_total: 10000, jefe_status: "Autorizado", finanzas_status: "Autorizado", estatus: "Cerrado", comprobante_viaje: "29/04/2026", created_at: "2026-04-25" },
  { id: "s5", folio: "#0037", user_id: "u3", fecha: "10/04/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL → Monterrey", tipo_viaje: "Comercial", motivo: "Reunión con clientes clave zona norte", personas_count: 2, personas_nombres: "M. Torres, C. Ibarra", monto_total: 4800, jefe_status: "Pendiente", finanzas_status: "N/A", estatus: "Abierto", comprobante_viaje: null, created_at: "2026-04-10" },
  { id: "s6", folio: "#0036", user_id: "u4", fecha: "01/04/2026", empresa: "WATA GROUP", origen: "Guadalajara", destino_resumen: "GDL → Querétaro", tipo_viaje: "Auditoría", motivo: "Cierre de auditoría fiscal anual", personas_count: 1, personas_nombres: "L. Vega", monto_total: 3100, jefe_status: "Autorizado", finanzas_status: "N/A", estatus: "Cerrado", comprobante_viaje: "05/04/2026", created_at: "2026-04-01" },
];

const SEED_AUTORIZACIONES: Autorizacion[] = [
  { id: "a1", solicitud_id: "s2", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-05-15", nota: "" },
  { id: "a2", solicitud_id: "s2", rol_autorizador: "finanzas", user_id: "u4", status: "autorizado", fecha: "2026-05-16", nota: "" },
  { id: "a3", solicitud_id: "s3", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-05-03", nota: "" },
  { id: "a4", solicitud_id: "s3", rol_autorizador: "finanzas", user_id: "u4", status: "rechazado", fecha: "2026-05-04", nota: "Monto de hotel no corresponde a tarifa acordada." },
  { id: "a5", solicitud_id: "s4", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-04-26", nota: "" },
  { id: "a6", solicitud_id: "s4", rol_autorizador: "finanzas", user_id: "u4", status: "autorizado", fecha: "2026-04-27", nota: "" },
  { id: "a7", solicitud_id: "s6", rol_autorizador: "jefe_inmediato", user_id: "u2", status: "autorizado", fecha: "2026-04-02", nota: "" },
];

const SEED_COMPROBANTES: ComprobanteGasto[] = [
  { id: "cg1", solicitud_id: "s2", concepto: "Hotel", monto_solicitado: 1600, monto_comprobado: 1600, status_renglon: "comprobado" },
  { id: "cg2", solicitud_id: "s2", concepto: "Transporte foráneo", monto_solicitado: 1800, monto_comprobado: 1800, status_renglon: "comprobado" },
  { id: "cg3", solicitud_id: "s2", concepto: "Transporte local", monto_solicitado: 400, monto_comprobado: 200, status_renglon: "parcialmente_comprobado" },
  { id: "cg4", solicitud_id: "s2", concepto: "Comida", monto_solicitado: 900, monto_comprobado: 0, status_renglon: "pendiente" },
  { id: "cg5", solicitud_id: "s2", concepto: "Otros", monto_solicitado: 500, monto_comprobado: 500, status_renglon: "comprobado" },
];

const SEED_CONFIG = {
  monto_comida_diario: 450,
  umbral_finanzas: 5000,
  dia_deposito: "Viernes",
  email_compras: "compras@cklass.com",
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
