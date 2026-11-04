// Hooks de lectura (TanStack Query) sobre la API. Todo lo que antes salía de localStorage
// (useLocalStorage / lsGet) se consulta aquí; las listas llegan ya filtradas por el alcance del rol.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, reportApiError } from "./api";
import type {
  Autorizacion,
  ComprobanteGasto,
  Convenio,
  CorreoSimulado,
  Factura,
  Hotel,
  LogEvento,
  RenglonGasto,
  RevisionMontoManual,
  Role,
  Sociedad,
  Solicitud,
  User,
} from "./store";

const VACIO: never[] = [];

// Datos de los listados se refrescan al volver a la ventana; los contadores del menú y la
// campanita además se sondean (ver `POLL_MS`).
export const POLL_MS = 30_000;

export type Catalogos = {
  sociedades: Sociedad[];
  hoteles: Hotel[];
  origenes: string[];
  estados: string[];
};

export type Config = {
  monto_comida_diario: number;
  umbral_finanzas: number;
  dia_deposito: string;
  email_compras: string;
  dias_comprobacion_atrasada: number;
  dias_autorizacion_pendiente: number;
  dias_recordatorio_viaje: number;
  notif_email_activo: boolean;
  notif_email_destinatarios: string;
  smtp_servidor: string;
  smtp_puerto: number;
  smtp_usuario: string;
  smtp_password?: string;
  smtp_cifrado: string;
  notif_plataforma_activo: boolean;
  revision_automatica_activo: boolean;
  bloquear_folio_monto_hotel: boolean;
};

export const CONFIG_DEFAULTS: Config = {
  monto_comida_diario: 450,
  umbral_finanzas: 5000,
  dia_deposito: "Viernes",
  email_compras: "",
  dias_comprobacion_atrasada: 7,
  dias_autorizacion_pendiente: 3,
  dias_recordatorio_viaje: 2,
  notif_email_activo: true,
  notif_email_destinatarios: "",
  smtp_servidor: "",
  smtp_puerto: 587,
  smtp_usuario: "",
  smtp_cifrado: "TLS",
  notif_plataforma_activo: true,
  revision_automatica_activo: true,
  bloquear_folio_monto_hotel: false,
};

/** Destino tal como lo guarda/regresa la API (hoteles, transportes, vales y automóvil anidados). */
export type DestinoApi = {
  id: string;
  solicitud_id?: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  hoteles: {
    id: string;
    fecha_inicio: string;
    fecha_fin: string;
    monto: number;
    manual: boolean;
    hotel_id: number;
    tipo_habitacion?: "sencilla" | "doble";
    motivo_cambio?: string;
  }[];
  foraneo: { id: string; tipo: string; monto: number }[];
  local: { id: string; tipo: string; monto: number }[];
  otros: { id: string; concepto: string; monto: number }[];
  automovil: { gasolina: number; caseta: number };
};

export type SolicitudDetalle = {
  solicitud: Solicitud;
  destinos: DestinoApi[];
  autorizaciones: Autorizacion[];
};

export type Bloqueo = { mensaje: string | null; folios: string[] };

/** `ventana=false` quita el límite de 2/4 meses (p. ej. Comprobación). */
const q = (ventana: boolean) => (ventana ? "" : "?ventana=0");

export const useCatalogos = () =>
  useQuery({ queryKey: ["catalogos"], queryFn: () => api.get<Catalogos>("/catalogos") });

export const useConfig = () =>
  useQuery({ queryKey: ["config"], queryFn: () => api.get<Config>("/config") });

export const useRoles = () =>
  useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles") });

export const useUsuarios = () =>
  useQuery({ queryKey: ["usuarios"], queryFn: () => api.get<User[]>("/usuarios") });

export const useSolicitudes = (ventana = true, opts: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: ["solicitudes", ventana],
    queryFn: () => api.get<Solicitud[]>(`/solicitudes${q(ventana)}`),
    refetchInterval: opts.poll ? POLL_MS : false,
  });

export const useAutorizaciones = (ventana = true) =>
  useQuery({ queryKey: ["autorizaciones", ventana], queryFn: () => api.get<Autorizacion[]>(`/autorizaciones${q(ventana)}`) });

export const useComprobantes = (ventana = true) =>
  useQuery({ queryKey: ["comprobantes", ventana], queryFn: () => api.get<ComprobanteGasto[]>(`/comprobantes${q(ventana)}`) });

export const useDestinos = (ventana = true, enabled = true) =>
  useQuery({ queryKey: ["destinos", ventana], queryFn: () => api.get<DestinoApi[]>(`/destinos${q(ventana)}`), enabled });

export const useSolicitudDetalle = (id: string | null | undefined) =>
  useQuery({
    queryKey: ["solicitud", id],
    queryFn: () => api.get<SolicitudDetalle>(`/solicitudes/${id}`),
    enabled: !!id,
  });

export const useBloqueoNuevaSolicitud = (enabled = true) =>
  useQuery({
    queryKey: ["bloqueo"],
    queryFn: () => api.get<Bloqueo>("/solicitudes/bloqueo"),
    enabled,
    refetchInterval: POLL_MS,
  });

export const useFacturas = (solicitudId: string | null | undefined) =>
  useQuery({
    queryKey: ["facturas", solicitudId],
    queryFn: () => api.get<Factura[]>(`/facturas?solicitud_id=${solicitudId}`),
    enabled: !!solicitudId,
  });

export const useConvenios = (enabled = true) =>
  useQuery({ queryKey: ["convenios"], queryFn: () => api.get<Convenio[]>("/convenios"), enabled });

export const useRevisionesMonto = (opts: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: ["revisiones"],
    queryFn: () => api.get<RevisionMontoManual[]>("/revisiones-monto"),
    refetchInterval: opts.poll ? POLL_MS : false,
  });

export const useRenglonesGasto = (enabled = true) =>
  useQuery({ queryKey: ["gasto"], queryFn: () => api.get<RenglonGasto[]>("/reportes/renglones-gasto"), enabled });

export const useLogs = (params: { entidad?: string; limit?: number } = {}, enabled = true) => {
  const qs = new URLSearchParams();
  if (params.entidad) qs.set("entidad", params.entidad);
  if (params.limit) qs.set("limit", String(params.limit));
  return useQuery({
    queryKey: ["logs", params],
    queryFn: () => api.get<LogEvento[]>(`/logs?${qs}`),
    enabled,
  });
};

export const useCorreos = (enabled = true) =>
  useQuery({ queryKey: ["correos"], queryFn: () => api.get<CorreoSimulado[]>("/correos"), enabled });

/** `data ?? []` tipado, para reemplazar directamente a `useLocalStorage<T[]>(…, [])`. */
export const lista = <T,>(data: T[] | undefined): T[] => data ?? (VACIO as T[]);

/**
 * Mutación genérica: al terminar invalida TODAS las consultas (los datos son pocos y así ninguna
 * pantalla queda desactualizada) y muestra el error de la API en el diálogo estándar.
 */
export function useApiMutation<TVars = void, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { onSuccess?: (res: TRes, vars: TVars) => void; silencioso?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: async (res, vars) => {
      await qc.invalidateQueries();
      opts.onSuccess?.(res, vars);
    },
    onError: (e) => {
      if (!opts.silencioso) reportApiError(e);
    },
  });
}
