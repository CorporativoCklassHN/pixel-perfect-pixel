import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Edit2, Plus, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useLocalStorage } from "@/lib/auth";
import { KEYS, type Role, type User, uid } from "@/lib/store";
import { Modal } from "./_portal.solicitar";

export const Route = createFileRoute("/_portal/usuarios")({
  head: () => ({ meta: [{ title: "Usuarios — CKL" }] }),
  component: Usuarios,
});

const ROLE_COLORS: Record<string, { bg: string; fg: string }> = {
  administrador: { bg: "#FEE9EA", fg: "#E30613" },
  finanzas: { bg: "#DBEAFE", fg: "#1D4ED8" },
  jefe_inmediato: { bg: "#D8F3DC", fg: "#2D6A4F" },
  gestor_vuelos: { bg: "#FEF3C7", fg: "#B45309" },
  usuario: { bg: "#F1F3F5", fg: "#555" },
};

function Usuarios() {
  const [users, setUsers] = useLocalStorage<User[]>(KEYS.users, []);
  const [roles] = useLocalStorage<Role[]>(KEYS.roles, []);
  const [edit, setEdit] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);

  const roleName = (id: number) => roles.find((r) => r.id === id)?.nombre ?? "—";
  const jefe = (id: string | null) => users.find((u) => u.id === id)?.nombre ?? "—";

  const toggleActive = (u: User) => setUsers(users.map((x) => x.id === u.id ? { ...x, activo: !x.activo } : x));

  const save = (u: User) => {
    if (creating) {
      setUsers([{ ...u, id: uid("u_") }, ...users]);
      toast.success("Usuario creado.");
    } else {
      setUsers(users.map((x) => x.id === u.id ? u : x));
      toast.success("Usuario actualizado.");
    }
    setEdit(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setCreating(true); setEdit({ id: "", nombre: "", correo: "", password: "", rfc: "", rol_id: 1, empresa: "WATA GROUP", jefe_id: null, activo: true, initials: "" }); }} className="ckl-btn-primary">
          <Plus size={14} /> Nuevo usuario
        </button>
      </div>

      <div className="ckl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Rol</th><th className="p-3">Empresa</th><th className="p-3">Jefe</th><th className="p-3">Activo</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const rc = ROLE_COLORS[roleName(u.rol_id)] ?? ROLE_COLORS.usuario;
                return (
                  <tr key={u.id} className="border-t">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: "var(--color-primary)" }}>{u.initials}</div>
                        <span>{u.nombre}</span>
                      </div>
                    </td>
                    <td className="p-3 text-xs">{u.correo}</td>
                    <td className="p-3"><span className="ckl-badge" style={{ background: rc.bg, color: rc.fg }}>{roleName(u.rol_id)}</span></td>
                    <td className="p-3 text-xs">{u.empresa}</td>
                    <td className="p-3 text-xs">{jefe(u.jefe_id)}</td>
                    <td className="p-3">
                      <button onClick={() => toggleActive(u)} className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" style={{ background: u.activo ? "var(--color-primary)" : "#ccc" }}>
                        <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" style={{ transform: u.activo ? "translateX(18px)" : "translateX(2px)" }} />
                      </button>
                    </td>
                    <td className="p-3">
                      <button onClick={() => { setCreating(false); setEdit(u); }} className="rounded p-1.5 hover:bg-secondary"><Edit2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {edit && <UserModal user={edit} roles={roles} users={users} onClose={() => { setEdit(null); setCreating(false); }} onSave={save} />}
    </div>
  );
}

function UserModal({ user, roles, users, onClose, onSave }: { user: User; roles: Role[]; users: User[]; onClose: () => void; onSave: (u: User) => void }) {
  const [u, setU] = useState<User>(user);
  const set = (k: keyof User, v: any) => setU((x) => ({ ...x, [k]: v }));
  return (
    <Modal onClose={onClose}>
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold"><UserCog size={18} /> {user.id ? "Editar usuario" : "Nuevo usuario"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="ckl-label">Nombre</label><input className="ckl-input" value={u.nombre} onChange={(e) => { set("nombre", e.target.value); set("initials", e.target.value.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()); }} /></div>
        <div><label className="ckl-label">Correo</label><input className="ckl-input" value={u.correo} onChange={(e) => set("correo", e.target.value)} /></div>
        <div><label className="ckl-label">RFC</label><input className="ckl-input" value={u.rfc} onChange={(e) => set("rfc", e.target.value)} /></div>
        <div><label className="ckl-label">Contraseña</label><input className="ckl-input" value={u.password} onChange={(e) => set("password", e.target.value)} /></div>
        <div>
          <label className="ckl-label">Rol</label>
          <select className="ckl-input" value={u.rol_id} onChange={(e) => set("rol_id", +e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="ckl-label">Empresa</label>
          <input className="ckl-input" value={u.empresa} onChange={(e) => set("empresa", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="ckl-label">Jefe</label>
          <select className="ckl-input" value={u.jefe_id ?? ""} onChange={(e) => set("jefe_id", e.target.value || null)}>
            <option value="">— Sin jefe —</option>
            {users.filter((x) => x.activo && x.id !== u.id).map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="ckl-btn-ghost">Cancelar</button>
        <button onClick={() => onSave(u)} className="ckl-btn-primary">Guardar</button>
      </div>
    </Modal>
  );
}
