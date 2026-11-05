import { useState } from "react";
import { Bell, CheckCircle2, XCircle, Hotel as HotelIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { showErrorDialog } from "@/components/ErrorDialog";
import { api } from "@/lib/api";
import { lista, useApiMutation, useRevisionesMonto, useUsuarios } from "@/lib/queries";
import {
  fmtMoney,
  hoyLocal,
  revisionVisible,
  type RevisionMontoManual,
} from "@/lib/store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const dmy = (iso: string) => (iso ? iso.split("T")[0].split("-").reverse().join("/") : "—");
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });

const ESTADO_UI = {
  pendiente: { label: "Pendiente", bg: "#FEF3C7", fg: "#B45309" },
  aceptado: { label: "Aceptado", bg: "#D8F3DC", fg: "#2D6A4F" },
  rechazado: { label: "Rechazado", bg: "#FEE9EA", fg: "#E30613" },
} as const;

// Campanita del encabezado. Para Compras Corporativas / Compras Corp (permiso
// revisar_monto_manual) lista las revisiones de montos manuales de hotel: las
// pendientes y las resueltas hoy (al día siguiente desaparecen).
export function NotificationBell() {
  const { user, hasPerm } = useAuth();
  const { data: revsData } = useRevisionesMonto({ poll: true });
  const { data: usersData } = useUsuarios();
  const revs = lista(revsData);
  const users = lista(usersData);
  const [abierto, setAbierto] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const revisor = hasPerm("revisar_monto_manual");
  const hoy = hoyLocal();
  // Nadie revisa su propia solicitud: esas no se le muestran.
  const items = revisor
    ? revs
        .filter((r) => revisionVisible(r, hoy) && r.user_id !== user?.id)
        .sort((a, b) => {
          if (a.estado === "pendiente" && b.estado !== "pendiente") return -1;
          if (b.estado === "pendiente" && a.estado !== "pendiente") return 1;
          return (b.decidido_at ?? b.creada_at).localeCompare(a.decidido_at ?? a.creada_at);
        })
    : [];
  const pendientes = items.filter((r) => r.estado === "pendiente").length;
  const nombre = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";
  const detalle = detalleId ? revs.find((r) => r.id === detalleId) : undefined;

  return (
    <>
      <Popover open={abierto} onOpenChange={setAbierto}>
        <PopoverTrigger asChild>
          <button
            className="relative shrink-0 rounded-md p-2 hover:bg-secondary"
            title="Notificaciones"
            aria-label={`Notificaciones${pendientes ? `: ${pendientes} pendientes` : ""}`}
          >
            <Bell size={18} />
            {pendientes > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ background: "var(--color-primary)" }}
              >
                {pendientes}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
          <div className="border-b px-4 py-3 text-sm font-semibold">Notificaciones</div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No tienes notificaciones.
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {items.map((r) => {
                const ui = ESTADO_UI[r.estado];
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary"
                      onClick={() => {
                        setAbierto(false);
                        setDetalleId(r.id);
                      }}
                    >
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{ background: "#FEF3C7", color: "#B45309" }}
                      >
                        <HotelIcon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">
                          {nombre(r.user_id)} cambió el monto de hotel · {r.folio}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {r.hotel_nombre}:{" "}
                          {r.tarifa_default > 0 ? `${fmtMoney(r.tarifa_default)} → ` : ""}
                          {fmtMoney(r.monto_manual)} por noche
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="ckl-badge" style={{ background: ui.bg, color: ui.fg }}>
                            {ui.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {fechaHora(r.decidido_at ?? r.creada_at)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {detalle && <RevisionDialog rev={detalle} onClose={() => setDetalleId(null)} />}
    </>
  );
}

function RevisionDialog({ rev, onClose }: { rev: RevisionMontoManual; onClose: () => void }) {
  const { user } = useAuth();
  const users = lista(useUsuarios().data);
  const [comentario, setComentario] = useState("");
  const nombre = (id?: string) => users.find((u) => u.id === id)?.nombre ?? "—";

  const tieneDefault = rev.tarifa_default > 0;
  const difNoche = rev.monto_manual - rev.tarifa_default;
  const pct = tieneDefault ? (difNoche / rev.tarifa_default) * 100 : 0;
  const totalDefault = rev.tarifa_default * rev.noches;
  const totalManual = rev.monto_manual * rev.noches;
  const ui = ESTADO_UI[rev.estado];
  const esPropia = rev.user_id === user?.id;

  const decidirMut = useApiMutation(
    (decision: "aceptado" | "rechazado") =>
      api.post(`/revisiones-monto/${rev.id}/decidir`, { decision, comentario }),
    {
      onSuccess: (_r, decision) => {
        toast.success(
          decision === "aceptado" ? "Cambio de monto aceptado." : "Cambio de monto rechazado.",
        );
        onClose();
      },
    },
  );

  const decidir = (decision: "aceptado" | "rechazado") => {
    if (!user) return;
    if (decision === "rechazado" && !comentario.trim()) {
      showErrorDialog("Captura un comentario para rechazar el cambio de monto.");
      return;
    }
    decidirMut.mutate(decision);
  };

  const fila = (k: string, v: React.ReactNode, destacado = false) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={destacado ? "font-semibold" : ""}>{v}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="ckl-card max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Monto manual de hotel"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-semibold">Monto manual de hotel</h3>
          <span className="ckl-badge shrink-0" style={{ background: ui.bg, color: ui.fg }}>
            {ui.label}
          </span>
        </div>

        <p className="text-sm">
          El usuario <b>{nombre(rev.user_id)}</b> seleccionó el hotel <b>{rev.hotel_nombre}</b> con un
          monto <b>diferente al predeterminado</b>.
        </p>

        <div className="divide-y rounded-lg border px-4">
          {fila("Folio", rev.folio, true)}
          {fila("Destino", rev.destino_estado)}
          {fila("Habitación", rev.tipo_habitacion === "doble" ? "Doble" : "Sencilla")}
          {fila("Estancia", `${dmy(rev.fecha_inicio)} → ${dmy(rev.fecha_fin)} (${rev.noches} noche(s))`)}
          {fila(
            "Monto predeterminado (por noche)",
            tieneDefault ? fmtMoney(rev.tarifa_default) : "Sin hotel de catálogo",
          )}
          {fila(
            "Monto del usuario (por noche)",
            <span style={{ color: "var(--color-primary)" }}>{fmtMoney(rev.monto_manual)}</span>,
            true,
          )}
          {tieneDefault &&
            fila(
              "Diferencia por noche",
              <span style={{ color: difNoche > 0 ? "#E30613" : "#2D6A4F" }}>
                {difNoche >= 0 ? "+" : "−"}
                {fmtMoney(Math.abs(difNoche))} ({pct >= 0 ? "+" : "−"}
                {Math.abs(pct).toFixed(1)}%)
              </span>,
            )}
          {tieneDefault &&
            fila("Total estancia", `${fmtMoney(totalDefault)} → ${fmtMoney(totalManual)}`, true)}
        </div>

        <div className="rounded-md bg-secondary p-3 text-sm">
          <div className="text-xs font-semibold text-muted-foreground">Motivo del usuario</div>
          <div className="mt-0.5">{rev.motivo ? rev.motivo : "Sin motivo capturado."}</div>
        </div>

        {rev.estado === "pendiente" ? (
          esPropia ? (
            <p className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">
              Es tu propia solicitud: la revisa otra persona de Compras.
            </p>
          ) : (
            <>
              <div>
                <label className="ckl-label">Comentario</label>
                <textarea
                  className="ckl-input min-h-[80px]"
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Opcional al aceptar; obligatorio al rechazar."
                  maxLength={400}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => decidir("rechazado")} className="ckl-btn-outline">
                  <XCircle size={15} /> Rechazar
                </button>
                <button onClick={() => decidir("aceptado")} className="ckl-btn-primary">
                  <CheckCircle2 size={15} /> Aceptar
                </button>
              </div>
            </>
          )
        ) : (
          <div className="space-y-2 rounded-md bg-secondary p-3 text-sm">
            <div>
              <b>{ui.label}</b> por {nombre(rev.decidido_por)}
              {rev.decidido_at ? ` · ${fechaHora(rev.decidido_at)}` : ""}
            </div>
            <div className="text-muted-foreground">
              {rev.comentario ? `“${rev.comentario}”` : "Sin comentario."}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Esta notificación se quita de tu lista al día siguiente.
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className="ckl-btn-ghost">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
