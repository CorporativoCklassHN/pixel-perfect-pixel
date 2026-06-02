import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, FileSpreadsheet, Mail } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useLocalStorage } from "@/lib/auth";
import { KEYS, fmtMoney, type Solicitud, type Sociedad, type User } from "@/lib/store";
import { StatusBadge } from "./_portal.dashboard";

export const Route = createFileRoute("/_portal/reportes")({
  head: () => ({ meta: [{ title: "Reportes — CKL" }] }),
  component: Reportes,
});

function Reportes() {
  const [solicitudes] = useLocalStorage<Solicitud[]>(KEYS.solicitudes, []);
  const [users] = useLocalStorage<User[]>(KEYS.users, []);
  const [sociedades] = useLocalStorage<Sociedad[]>(KEYS.sociedades, []);
  const [fi, setFi] = useState("");
  const [ff, setFf] = useState("");
  const [soc, setSoc] = useState("Todas");
  const [acreedor, setAcreedor] = useState("");
  const [venc, setVenc] = useState("Todos");
  const [results, setResults] = useState<Solicitud[]>(solicitudes);

  const userName = (id: string) => users.find((u) => u.id === id)?.nombre ?? "—";

  const search = () => {
    const r = solicitudes.filter((s) => {
      const d = new Date(s.created_at);
      if (fi && d < new Date(fi)) return false;
      if (ff && d > new Date(ff)) return false;
      if (soc !== "Todas" && s.empresa !== soc) return false;
      if (acreedor) {
        const u = users.find((x) => x.id === s.user_id);
        if (!u || (!u.nombre.toLowerCase().includes(acreedor.toLowerCase()) && !u.rfc.toLowerCase().includes(acreedor.toLowerCase()))) return false;
      }
      const days = (Date.now() - d.getTime()) / 86400000;
      if (venc === "Vencidos" && days <= 7) return false;
      if (venc === "A tiempo" && days > 7) return false;
      return true;
    });
    setResults(r);
    toast.success(`${r.length} resultado(s).`);
  };

  const exportar = () => {
    const data = results.map((s) => ({
      Folio: s.folio, Fecha: s.fecha, Usuario: userName(s.user_id),
      Sociedad: s.empresa, Destino: s.destino_resumen,
      Monto: s.monto_total, Estatus: s.estatus,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Reporte");
    XLSX.writeFile(wb, `reporte_viaticos_${Date.now()}.xlsx`);
    toast.success("Excel descargado.");
  };

  const enriched = useMemo(() => results.map((s) => {
    const days = (Date.now() - new Date(s.created_at).getTime()) / 86400000;
    return { ...s, vencimiento: days > 7 && s.estatus === "Cerrado" && !s.comprobante_viaje ? "Vencido" : "A tiempo" };
  }), [results]);

  return (
    <div className="space-y-4">
      <div className="ckl-card p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div><label className="ckl-label">Fecha inicial *</label><input type="date" className="ckl-input" value={fi} onChange={(e) => setFi(e.target.value)} /></div>
          <div><label className="ckl-label">Fecha final *</label><input type="date" className="ckl-input" value={ff} onChange={(e) => setFf(e.target.value)} /></div>
          <div>
            <label className="ckl-label">Sociedad</label>
            <select className="ckl-input" value={soc} onChange={(e) => setSoc(e.target.value)}>
              <option>Todas</option>
              {sociedades.map((s) => <option key={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div><label className="ckl-label">Acreedor SAP</label><input className="ckl-input" value={acreedor} onChange={(e) => setAcreedor(e.target.value)} placeholder="Nombre o RFC" /></div>
          <div>
            <label className="ckl-label">Vencimiento</label>
            <select className="ckl-input" value={venc} onChange={(e) => setVenc(e.target.value)}>
              {["Todos", "A tiempo", "Vencidos"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={search} className="ckl-btn-primary"><Search size={14} /> Buscar</button>
          <button onClick={exportar} className="ckl-btn-outline"><FileSpreadsheet size={14} /> Exportar Excel</button>
          <button onClick={() => toast.success("Reporte enviado al correo registrado.")} className="ckl-btn-outline"><Mail size={14} /> Correo</button>
        </div>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Folio</th><th className="p-3">Fecha</th><th className="p-3">Usuario</th><th className="p-3">Sociedad</th><th className="p-3">Destino</th><th className="p-3 text-right">Monto</th><th className="p-3">Vencimiento</th><th className="p-3">Estatus</th></tr>
            </thead>
            <tbody>
              {enriched.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{s.folio}</td>
                  <td className="p-3 text-xs">{s.fecha}</td>
                  <td className="p-3">{userName(s.user_id)}</td>
                  <td className="p-3 text-xs">{s.empresa}</td>
                  <td className="p-3 text-xs">{s.destino_resumen}</td>
                  <td className="p-3 text-right font-semibold">{fmtMoney(s.monto_total)}</td>
                  <td className="p-3"><span className="ckl-badge" style={{ background: s.vencimiento === "Vencido" ? "#FEE9EA" : "#D8F3DC", color: s.vencimiento === "Vencido" ? "#E30613" : "#2D6A4F" }}>{s.vencimiento}</span></td>
                  <td className="p-3"><StatusBadge estatus={s.estatus} /></td>
                </tr>
              ))}
              {enriched.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-xs text-muted-foreground">Sin resultados</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
