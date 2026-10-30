import { useRef, useState } from "react";
import { CheckCircle2, Circle, FileCode, FileText, Camera, UploadCloud, X } from "lucide-react";
import { fmtMoney, type ComprobanteGasto } from "@/lib/store";

export type ArchivosComprobante = { xml?: File; pdf?: File };

// Un solo diálogo para adjuntar el comprobante de un concepto. Para los conceptos con
// factura se piden el XML y el PDF **juntos** (se pueden elegir o arrastrar los dos a la
// vez) y solo entonces se puede subir; los vales llevan un único archivo (foto o PDF).
export function SubirComprobanteDialog({
  renglon,
  onClose,
  onSubir,
}: {
  renglon: ComprobanteGasto;
  onClose: () => void;
  onSubir: (archivos: ArchivosComprobante) => Promise<boolean>;
}) {
  const esVales = renglon.concepto === "Vales";
  const [xml, setXml] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null); // en vales: foto o PDF
  const [error, setError] = useState("");
  const [arrastrando, setArrastrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pendiente = Math.max(0, renglon.monto_solicitado - renglon.monto_comprobado);

  const clasificar = (lista: File[]) => {
    setError("");
    for (const f of lista) {
      const n = f.name.toLowerCase();
      if (esVales) {
        if (/\.xml$/.test(n)) setError("Los vales se comprueban con una foto o un PDF, no con XML.");
        else if (/\.(pdf|jpe?g|png)$/.test(n)) setPdf(f);
        else setError("Formato no válido. Usa JPG, PNG o PDF.");
      } else if (/\.xml$/.test(n)) setXml(f);
      else if (/\.pdf$/.test(n)) setPdf(f);
      else setError("Solo se aceptan archivos XML y PDF.");
    }
  };

  const listo = esVales ? !!pdf : !!xml && !!pdf;

  const subir = async () => {
    if (!listo || enviando) return;
    setEnviando(true);
    const ok = await onSubir({ xml: xml ?? undefined, pdf: pdf ?? undefined });
    setEnviando(false);
    if (ok) onClose();
  };

  const fila = (
    icono: React.ReactNode,
    etiqueta: string,
    archivo: File | null,
    quitar: () => void,
  ) => (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
      style={{ borderColor: archivo ? "#86C99B" : "var(--color-border)", background: archivo ? "#F2FBF5" : "white" }}
    >
      <span style={{ color: archivo ? "#2D6A4F" : "#9CA3AF" }}>
        {archivo ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </span>
      <span className="text-muted-foreground">{icono}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{etiqueta}</div>
        <div className="truncate text-xs text-muted-foreground">
          {archivo ? archivo.name : "Falta este archivo"}
        </div>
      </div>
      {archivo && (
        <button
          type="button"
          onClick={quitar}
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
          aria-label={`Quitar ${etiqueta}`}
        >
          <X size={14} />
        </button>
      )}
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
        aria-label={`Adjuntar comprobante de ${renglon.concepto}`}
      >
        <div>
          <h3 className="text-lg font-semibold">Adjuntar comprobante · {renglon.concepto}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Pendiente por comprobar: <b>{fmtMoney(pendiente)}</b> de {fmtMoney(renglon.monto_solicitado)}
          </p>
        </div>

        <p className="rounded-md bg-secondary p-3 text-xs">
          {esVales ? (
            <>
              Los <b>vales</b> se comprueban con <b>una foto o un PDF</b> (JPG, PNG o PDF). No se
              pide XML.
            </>
          ) : (
            <>
              Para que el comprobante cuente debes subir el <b>XML y el PDF juntos</b>. Puedes
              seleccionar o arrastrar los dos archivos a la vez.
            </>
          )}
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            clasificar(Array.from(e.dataTransfer.files));
          }}
          className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center"
          style={{
            borderColor: arrastrando ? "var(--color-primary)" : "var(--color-border)",
            background: arrastrando ? "var(--color-primary-soft)" : "transparent",
          }}
        >
          <UploadCloud size={26} className="text-muted-foreground" />
          <div className="text-sm">
            {esVales ? "Arrastra la foto o el PDF aquí" : "Arrastra el XML y el PDF aquí"}
          </div>
          <button type="button" className="ckl-btn-outline" onClick={() => input.current?.click()}>
            {esVales ? "Seleccionar archivo" : "Seleccionar archivos"}
          </button>
          <input
            ref={input}
            type="file"
            className="hidden"
            aria-label="Seleccionar archivos"
            multiple={!esVales}
            accept={esVales ? ".pdf,.jpg,.jpeg,.png" : ".xml,.pdf"}
            onChange={(e) => {
              clasificar(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        <div className="space-y-2">
          {esVales ? (
            fila(<Camera size={16} />, "Foto o PDF de los vales", pdf, () => setPdf(null))
          ) : (
            <>
              {fila(<FileCode size={16} />, "XML (CFDI)", xml, () => setXml(null))}
              {fila(<FileText size={16} />, "PDF de la factura", pdf, () => setPdf(null))}
            </>
          )}
        </div>

        {error && (
          <p className="text-xs font-medium" style={{ color: "var(--color-primary)" }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="ckl-btn-ghost">
            Cancelar
          </button>
          <button onClick={subir} disabled={!listo || enviando} className="ckl-btn-primary">
            {enviando ? "Subiendo…" : "Subir comprobante"}
          </button>
        </div>
      </div>
    </div>
  );
}
