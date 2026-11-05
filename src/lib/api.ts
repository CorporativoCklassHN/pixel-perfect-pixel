// Cliente HTTP de la API (Express, /api). Sustituye al antiguo acceso a localStorage.
import { showErrorDialog } from "@/components/ErrorDialog";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Opts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown; // JSON, o FormData para subir archivos
};

// El AuthProvider escucha estos eventos para cerrar la sesión local.
export const AUTH_EVENT = "ckl:auth";
export type AuthEventDetail = { reason: "session_replaced" | "unauthorized" };

async function request<T>(path: string, { method = "GET", body }: Opts = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.", "NETWORK");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; code?: string };
    if (res.status === 401 && typeof window !== "undefined" && path !== "/auth/login" && path !== "/auth/me") {
      const reason = err.code === "SESSION_REPLACED" ? "session_replaced" : "unauthorized";
      window.dispatchEvent(new CustomEvent<AuthEventDetail>(AUTH_EVENT, { detail: { reason } }));
    }
    throw new ApiError(res.status, err.error ?? `Error ${res.status}`, err.code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Muestra el mensaje de un error de la API en el diálogo bloqueante estándar. */
export function reportApiError(e: unknown) {
  if (e instanceof ApiError && (e.code === "SESSION_REPLACED" || e.code === "NO_AUTH")) return;
  showErrorDialog(e instanceof Error ? e.message : "Ocurrió un error inesperado.");
}
