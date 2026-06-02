import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Edit2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useLocalStorage } from "@/lib/auth";
import { KEYS, type Sociedad } from "@/lib/store";
import { Modal } from "./_portal.solicitar";

export const Route = createFileRoute("/_portal/configuracion")({
  head: () => ({ meta: [{ title: "Configuración — CKL" }] }),
  component: Configuracion,
});

type Config = { monto_comida_diario: number; umbral_finanzas: number; dia_deposito: string; email_compras: string };

function Configuracion() {
  const { hasPerm } = useAuth();
  const [config, setConfig] = useLocalStorage<Config>(KEYS.config, { monto_comida_diario: 450, umbral_finanzas: 5000, dia_deposito: "Viernes", email_compras: "compras@cklass.com" });
  const [sociedades, setSociedades] = useLocalStorage<Sociedad[]>(KEYS.sociedades, []);
  const [draft, setDraft] = useState<Config>(config);
  const [edit, setEdit] = useState<Sociedad | null>(null);

  if (!hasPerm("configurar_montos")) {
    return <div className="ckl-card p-8 text-center text-sm">Sin permiso para acceder.</div>;
  }

  const saveCfg = () => { setConfig(draft); toast.success("Configuración guardada."); };

  const saveSoc = (s: Sociedad) => {
    if (s.id === 0) {
      const newId = Math.max(0, ...sociedades.map((x) => x.id)) + 1;
      setSociedades([...sociedades, { ...s, id: newId }]);
    } else {
      setSociedades(sociedades.map((x) => x.id === s.id ? s : x));
    }
    toast.success("Sociedad guardada.");
    setEdit(null);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="ckl-card p-5">
        <h3 className="text-base font-semibold">Montos y reglas</h3>
        <div className="mt-4 space-y-3">
          <div><label className="ckl-label">Monto comida diario ($)</label><input type="number" className="ckl-input" value={draft.monto_comida_diario} onChange={(e) => setDraft({ ...draft, monto_comida_diario: +e.target.value })} /></div>
          <div><label className="ckl-label">Umbral Finanzas ($)</label><input type="number" className="ckl-input" value={draft.umbral_finanzas} onChange={(e) => setDraft({ ...draft, umbral_finanzas: +e.target.value })} /></div>
          <div>
            <label className="ckl-label">Día de depósito</label>
            <select className="ckl-input" value={draft.dia_deposito} onChange={(e) => setDraft({ ...draft, dia_deposito: e.target.value })}>
              {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div><label className="ckl-label">Email compras</label><input className="ckl-input" value={draft.email_compras} onChange={(e) => setDraft({ ...draft, email_compras: e.target.value })} /></div>
        </div>
        <button onClick={saveCfg} className="ckl-btn-primary mt-4">Guardar</button>
      </div>

      <div className="ckl-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Sociedades</h3>
          <button onClick={() => setEdit({ id: 0, nombre: "", rfc: "", regimen: "601 - Gral. Personas Morales", cp: "", UsoCFDI: "Gastos en General", sociedad_sap: "" })} className="ckl-btn-outline"><Plus size={14} /> Agregar</button>
        </div>
        <div className="mt-3 divide-y">
          {sociedades.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-semibold">{s.nombre}</div>
                <div className="text-xs text-muted-foreground">{s.rfc} · SAP {s.sociedad_sap}</div>
              </div>
              <button onClick={() => setEdit(s)} className="rounded p-1.5 hover:bg-secondary"><Edit2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {edit && (
        <Modal onClose={() => setEdit(null)}>
          <h3 className="mb-3 text-lg font-semibold">{edit.id ? "Editar" : "Nueva"} sociedad</h3>
          <div className="grid grid-cols-2 gap-3">
            {(["nombre", "rfc", "regimen", "cp", "UsoCFDI", "sociedad_sap"] as const).map((k) => (
              <div key={k} className={k === "nombre" || k === "regimen" ? "col-span-2" : ""}>
                <label className="ckl-label">{k}</label>
                <input className="ckl-input" value={(edit as any)[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="ckl-btn-ghost">Cancelar</button>
            <button onClick={() => saveSoc(edit)} className="ckl-btn-primary">Guardar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
