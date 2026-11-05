// Portal de Viáticos CKL — tipos del dominio y funciones PURAS de apoyo.
// Los datos viven en MySQL y se consumen por la API (server/) con los hooks de src/lib/queries.ts.

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
  // La API nunca devuelve la contraseña; solo se envía al crear o cambiar una cuenta.
  password?: string;
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
  // Tarifa por noche en habitación doble (si el hotel ofrece los dos tipos). La de
  // habitación sencilla es `tarifa_base`.
  tarifa_doble?: number | null;
  // Presente cuando el hotel lo mantiene un convenio (ver sincronizarCatalogoConvenios).
  convenio_clave?: string;
};

export type TipoHabitacion = "sencilla" | "doble";

// Tarifa predeterminada por noche de un hotel según el tipo de habitación elegido.
export function tarifaHotel(h: Pick<Hotel, "tarifa_base" | "tarifa_doble"> | undefined, tipo: TipoHabitacion = "sencilla") {
  if (!h) return 0;
  return tipo === "doble" && h.tarifa_doble && h.tarifa_doble > 0 ? h.tarifa_doble : h.tarifa_base;
}

// Precio con centavos solo cuando los tiene (tarifas de convenio como $737.50).
export function fmtTarifa(n: number) {
  return Number.isInteger(n)
    ? fmtMoney(n)
    : "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  // Validación de Compras Corporativas (opcionales: datos anteriores no los traen).
  validado?: boolean;
  validado_por?: string;
  validado_fecha?: string;
  nota_validacion?: string;
};

export function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("es-MX", { maximumFractionDigits: 0 });
}

// ───────── Estatus visible ─────────
// El valor guardado en Solicitud.estatus sigue siendo Abierto/Cerrado/Rechazado
// (retrocompatibilidad con datos sembrados y persistidos). Lo que ve el usuario
// se deriva de ese valor + el avance de comprobación:
//   Abierto → "Pendiente" · Rechazado → "Rechazado"
//   Cerrado sin comprobar por completo → "Autorizado" · Cerrado y comprobado → "Comprobado"
export type EstatusVisible = "Pendiente" | "Autorizado" | "Comprobado" | "Rechazado";

export const ESTATUS_VISIBLES: EstatusVisible[] = [
  "Pendiente",
  "Autorizado",
  "Comprobado",
  "Rechazado",
];

// Avance de comprobación de un folio: comprobado solo cuando el total
// comprobado iguala al total solicitado (>0) sumando todos sus renglones.
// `soloAvion` limita el cálculo al concepto "Avión" (vista del gestor de vuelos).
export function avanceComprobacion(
  comprobantes: ComprobanteGasto[],
  solicitudId: string,
  soloAvion = false,
) {
  const filas = comprobantes
    .filter((c) => c.solicitud_id === solicitudId)
    .filter((c) => !soloAvion || c.concepto === "Avión");
  const solicitado = filas.reduce((a, r) => a + r.monto_solicitado, 0);
  const comprobado = filas.reduce((a, r) => a + r.monto_comprobado, 0);
  const completo = solicitado > 0 && comprobado === solicitado;
  const pct = solicitado > 0 ? Math.min(100, Math.round((comprobado / solicitado) * 100)) : 0;
  return { solicitado, comprobado, completo, pct };
}

export function estatusVisible(estatus: string, comprobado: boolean): EstatusVisible {
  if (estatus === "Cerrado") return comprobado ? "Comprobado" : "Autorizado";
  if (estatus === "Rechazado") return "Rechazado";
  return "Pendiente";
}

// ───────── Nueva solicitud: folios sin comprobar ─────────
// Un usuario con este número (o más) de folios autorizados (Cerrado) y sin
// comprobar por completo no puede generar una nueva solicitud hasta concluir
// la comprobación de alguno.
export const MAX_FOLIOS_SIN_COMPROBAR = 2;

export function foliosSinComprobar(
  userId: string,
  solicitudes: Solicitud[],
  comprobantes: ComprobanteGasto[],
): Solicitud[] {
  return solicitudes.filter(
    (s) =>
      s.user_id === userId &&
      s.estatus === "Cerrado" &&
      !avanceComprobacion(comprobantes, s.id).completo,
  );
}

// ───────── Cambio de contraseña ─────────
const CONTRASENAS_COMUNES = [
  "password", "contrasena", "contraseña", "admin", "administrador", "qwerty",
  "abcdef", "letmein", "welcome", "bienvenido", "cklass", "viaticos", "viáticos",
  "123456", "12345678", "iloveyou", "monkey", "dragon", "football", "futbol",
];

export const PASSWORD_MIN_LENGTH = 6;

export function evaluarContrasena(nueva: string, user: Pick<User, "correo" | "nombre">) {
  const lower = nueva.toLowerCase();
  const usuarioCorreo = user.correo.split("@")[0].toLowerCase();
  const longitud = nueva.length >= PASSWORD_MIN_LENGTH;
  const todoIgual = /^(.)\1+$/.test(nueva);
  const secuencia = /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i.test(nueva);
  const comun =
    CONTRASENAS_COMUNES.some((c) => lower.includes(c)) ||
    (usuarioCorreo.length >= 4 && lower.includes(usuarioCorreo)) ||
    todoIgual ||
    secuencia;
  return { longitud, noComun: nueva.length > 0 && !comun };
}

// ───────── Validación de Compras Corporativas ─────────
// Compras revisa, concepto por concepto, que las facturas de un folio ya
// comprobado por completo sean reales (casilla "Validado" + "Nota" opcional).
// Solo cuentan los renglones con monto solicitado > 0 (un renglón en $0 no tiene
// factura que validar).
export function avanceValidacion(comprobantes: ComprobanteGasto[], solicitudId: string) {
  const filas = comprobantes.filter(
    (c) => c.solicitud_id === solicitudId && c.monto_solicitado > 0,
  );
  const validados = filas.filter((c) => c.validado).length;
  return {
    total: filas.length,
    validados,
    completa: filas.length > 0 && validados === filas.length,
  };
}

// Los roles guardados antes de que existiera "validar_comprobacion" no lo traen: se
// le da a Compras Corporativas sin tocar el resto de sus permisos (ni los ajustes
// que el admin ya haya hecho en la matriz de Permisos).
//
// Aplica a "compras_corporativas" y también a roles de Compras creados a mano desde
// Configuración (p. ej. "compras_corp"): cualquier rol cuyo nombre empiece con "compras"
// y que aún no tenga la clave. Si el admin ya la definió (true o false) no se toca.

// ───────── Montos manuales de hotel: revisión de Compras ─────────
// Cuando una solicitud se guarda con un hotel cuyo "Monto manual por noche" es
// distinto al predeterminado del catálogo, se abre una revisión para Compras
// (campanita del portal + correo informativo). Compras la acepta o rechaza con un
// comentario; la revisión resuelta se oculta de su lista al día siguiente.
export type RevisionMontoManual = {
  id: string;
  solicitud_id: string;
  folio: string;
  user_id: string; // quien solicitó
  destino_estado: string;
  hotel_stay_id: string;
  hotel_id: number; // 0 = sin hotel de catálogo
  hotel_nombre: string;
  tipo_habitacion?: TipoHabitacion; // ausente = sencilla
  tarifa_default: number; // por noche, del catálogo (0 si no hay hotel de catálogo)
  monto_manual: number; // por noche, el que capturó el usuario
  motivo?: string; // por qué el usuario cambió el monto
  noches: number;
  fecha_inicio: string;
  fecha_fin: string;
  creada_at: string; // ISO con hora
  estado: "pendiente" | "aceptado" | "rechazado";
  // false cuando una edición de la solicitud la dejó sin efecto (otro hotel/monto): ya no
  // se muestra en la campanita ni bloquea el folio. Ausente = vigente.
  vigente?: boolean;
  decidido_por?: string;
  decidido_at?: string; // ISO con hora
  comentario?: string;
};

// Sin servidor de correo todavía: cada correo queda registrado aquí (estado "simulado").
export type CorreoSimulado = {
  id: string;
  fecha: string; // ISO con hora
  para: string; // correo
  usuario_id: string;
  asunto: string;
  cuerpo: string;
  referencia: string; // id de la revisión
  estado: "simulado" | "omitido"; // "omitido": notificaciones por correo desactivadas en Configuración
};

// Bitácora de eventos (tabla `logs`: id, fecha, tipo, entidad, entidad_id, usuario_id, detalle JSON).
export type LogEvento = {
  id: string;
  fecha: string; // ISO con hora
  tipo: string;
  entidad: string;
  entidad_id: string;
  usuario_id: string | null;
  detalle: Record<string, unknown>;
};

const dos = (n: number) => String(n).padStart(2, "0");
// Fecha local (YYYY-MM-DD), no UTC: "al día siguiente" se cuenta por día natural del usuario.
export function hoyLocal(d: Date = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
export function fechaLocal(iso: string) {
  return hoyLocal(new Date(iso));
}

// Una revisión se muestra mientras esté pendiente y, una vez resuelta, solo durante
// el día en que se resolvió: al día siguiente desaparece de la lista.
export function revisionVisible(r: RevisionMontoManual, hoy: string = hoyLocal()) {
  if (r.vigente === false) return false;
  return r.estado === "pendiente" || (!!r.decidido_at && fechaLocal(r.decidido_at) === hoy);
}

// Bloqueo de autorización por monto manual de hotel (parámetro de Configuración
// "bloquear_folio_monto_hotel"). Devuelve el motivo si el folio está bloqueado o null.
// Pendiente de Compras → bloqueado; rechazado por Compras → bloqueado hasta que el
// solicitante edite la solicitud (la edición deja sin efecto la revisión rechazada);
// aceptado → libre. Con el parámetro apagado (por omisión) nunca bloquea.
export function bloqueoMontoHotel(
  solicitudId: string,
  revisiones: RevisionMontoManual[],
  config: { bloquear_folio_monto_hotel?: boolean },
): string | null {
  if (!config.bloquear_folio_monto_hotel) return null;
  const vigentes = revisiones.filter((r) => r.solicitud_id === solicitudId && r.vigente !== false);
  const rechazada = vigentes.find((r) => r.estado === "rechazado");
  if (rechazada) {
    return `Bloqueado: Compras rechazó el monto manual de hotel (${rechazada.hotel_nombre}). El solicitante debe editar la solicitud.`;
  }
  const pendiente = vigentes.find((r) => r.estado === "pendiente");
  if (pendiente) {
    return `Bloqueado: el monto manual de hotel (${pendiente.hotel_nombre}) está pendiente de revisión de Compras.`;
  }
  return null;
}

// Usuarios activos cuyo rol puede revisar montos manuales (Compras Corporativas y Compras Corp).

// ───────── Convenios con hoteles (Compras Corporativas) ─────────
// Altas, bajas y modificaciones de los convenios con hoteles. La "baja" es lógica
// (activo: false, con motivo y fecha) para conservar el historial; cada movimiento
// queda en la bitácora (tabla `logs`).
export type Convenio = {
  id: string;
  anio: number;
  tipo_sucursal: string;
  no_sucursal: string;
  destino: string; // ciudad
  estado: string; // estado de la República (con el que Solicitar ubica el hotel)
  nombre_comercial: string;
  costo_sencilla: number; // por noche
  costo_doble: number | null; // por noche (opcional)
  no_proveedor: string;
  razon_social: string;
  telefono: string;
  contacto: string;
  banco: string;
  correo: string;
  notas: string;
  activo: boolean;
  baja_motivo?: string;
  baja_fecha?: string; // ISO
  creado_at: string; // ISO
  actualizado_at: string; // ISO
};

// ───────── Comprobantes (facturas) por par XML + PDF ─────────
// Un concepto con factura se considera comprobado solo cuando el usuario carga el
// **par XML + PDF** juntos; los dos archivos comparten `par_id`, el XML trae el
// total y es el que aplica `monto_aplicado` al renglón. Los vales se comprueban con
// un solo archivo (foto o PDF), sin XML. Un archivo suelto heredado (sin `par_id`)
// queda "Incompleto" y no suma al comprobado.
export type Factura = {
  id: string;
  solicitud_id: string;
  tipo: "XML" | "PDF" | "FOTO";
  fecha: string;
  uuid: string;
  archivo: string;
  total: number;
  status: "Verificado" | "Error" | "Incompleto";
  // Renglón de comprobación al que se aplicó el monto y cuánto se aplicó (permite
  // revertir exacto al eliminar).
  concepto_id: string | null;
  monto_aplicado: number;
  // El archivo vive en la BD; se abre con `url` (GET /api/facturas/:id/archivo).
  url?: string;
  par_id?: string;
};

export function conceptoRequierePar(concepto: string) {
  return concepto !== "Vales";
}

// Agrupa los archivos de un mismo comprobante (par XML+PDF); los sueltos quedan solos.
export function agruparFacturas(fs: Factura[]): Factura[][] {
  const grupos: Factura[][] = [];
  const porPar = new Map<string, Factura[]>();
  for (const f of fs) {
    if (!f.par_id) {
      grupos.push([f]);
      continue;
    }
    let g = porPar.get(f.par_id);
    if (!g) {
      g = [];
      porPar.set(f.par_id, g);
      grupos.push(g);
    }
    g.push(f);
  }
  // XML primero dentro de cada par
  for (const g of grupos) g.sort((a, b) => (a.tipo === "XML" ? -1 : 0) - (b.tipo === "XML" ? -1 : 0));
  return grupos;
}

// La gasolina no se comprueba: ya no genera renglón de comprobación. Se retiran los que
// se hubieran creado (y sus archivos).

export const ESTADOS_MX = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas",
  "Chihuahua", "CDMX", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato",
  "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca",
  "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco",
  "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

// ───────── Gasto por concepto (Dashboard y Reportes) ─────────
// Para Administrador, Finanzas y Compras (permiso ver_gasto_por_concepto). Se construye a
// partir de los renglones de comprobación de cada solicitud (concepto + monto solicitado /
// comprobado) y de la gasolina del desglose del destino (la gasolina no se comprueba, así
// que cuenta igual como solicitada y como comprobada). Las solicitudes rechazadas no cuentan.
export type CategoriaGasto =
  | "Hotel"
  | "Transporte foráneo"
  | "Transporte local"
  | "Comida"
  | "Automóvil"
  | "Vales";

// Orden fijo: define el color de cada concepto en las gráficas (nunca se reordena por monto).
export const CATEGORIAS_GASTO: CategoriaGasto[] = [
  "Hotel",
  "Transporte foráneo",
  "Transporte local",
  "Comida",
  "Automóvil",
  "Vales",
];

export type RenglonGasto = {
  solicitud_id: string;
  folio: string;
  user_id: string;
  empresa: string;
  created_at: string; // YYYY-MM-DD
  categoria: CategoriaGasto;
  subconcepto: string; // Avión, Autobús, Uber, Gasolina, Caseta…
  solicitado: number;
  comprobado: number;
};
