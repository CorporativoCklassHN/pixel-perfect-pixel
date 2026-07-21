import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { KEYS, lsGet, lsSet, uid, type Sociedad } from "@/lib/store";
import cklassLogo from "@/cklass-logo.png";
import imagenInicio from "@/imagen-inicio.png";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Portal de Viáticos CKL" },
      { name: "description", content: "Acceso al portal corporativo de viáticos Grupo Cklass." },
    ],
  }),
  component: LoginPage,
});


function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "prealta">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(email, pass)) {
      toast.success(`Bienvenido`);
      navigate({ to: "/dashboard" });
    } else {
      toast.error("Credenciales incorrectas.");
    }
  };

  return (
    <div className="flex min-h-screen" style={{ background: "#F2F2F2" }}>
      {/* LEFT */}
      <div className="relative hidden flex-1 overflow-hidden lg:flex" style={{ background: "#F2F2F2" }}>
        <img src={imagenInicio} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-white/70" />
        <div className="relative z-10 flex w-full flex-col justify-between p-12">
          <div>
            <img src={cklassLogo} alt="Cklass" className="h-10 w-auto" />
          </div>
          <div className="max-w-lg">
            <h1 className="text-4xl font-bold leading-tight" style={{ color: "#111111" }}>
              Portal de Viáticos
            </h1>
            <p className="mt-3 text-sm" style={{ color: "#333333" }}>
              Gestión integral de solicitudes y comprobaciones.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-4">
              <div className="rounded-lg border bg-white p-5" style={{ borderColor: "#DDDDDD" }}>
                <div className="text-[11px] uppercase tracking-wider" style={{ color: "#555555" }}>
                  Solicitudes activas
                </div>
                <div className="mt-2 text-3xl font-bold" style={{ color: "#111111" }}>47</div>
              </div>
              <div className="rounded-lg border bg-white p-5" style={{ borderColor: "#DDDDDD" }}>
                <div className="text-[11px] uppercase tracking-wider" style={{ color: "#555555" }}>
                  Ejercido este mes
                </div>
                <div className="mt-2 text-3xl font-bold" style={{ color: "#111111" }}>$284,500</div>
              </div>
            </div>
          </div>
          <p className="text-xs" style={{ color: "#555555" }}>
            © {new Date().getFullYear()} Grupo Cklass. Todos los derechos reservados.
          </p>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-10 lg:w-[480px]" style={{ background: "#F2F2F2" }}>
        <div className="w-full max-w-md rounded-lg bg-white p-9" style={{ border: "1px solid #DDDDDD" }}>
          <div className="mb-6 flex justify-center">
            <img src={cklassLogo} alt="Cklass" className="h-12 w-auto" />
          </div>
          {mode === "login" ? (
            <>
              <h2 className="text-center text-xl font-semibold">Inicia sesión en tu cuenta</h2>
              <p className="mt-1 text-center text-sm" style={{ color: "#444444" }}>
                Ingresa con tu correo corporativo.
              </p>
              <form className="mt-6 space-y-4" onSubmit={handleLogin}>
                <div>
                  <label className="ckl-label">Correo Corporativo</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="usuario@cklass.com"
                    className="ckl-input"
                    style={{ borderColor: "#E30613", borderWidth: 1.5 }}
                  />
                </div>
                <div>
                  <label className="ckl-label">Contraseña</label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={pass}
                      onChange={(e) => setPass(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="ckl-input pr-10"
                    />
                    <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground">
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <a href="#" className="text-xs" style={{ color: "#444444" }}>¿Olvidaste la contraseña?</a>
                </div>
                <button type="submit" className="ckl-btn-primary w-full justify-center">Iniciar sesión</button>
              </form>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex-1 border-t" /> o <div className="flex-1 border-t" />
              </div>
              <div className="space-y-2">
                <button onClick={() => setMode("prealta")} className="ckl-btn-ghost w-full justify-center">Pre-Alta</button>
              </div>
              <div className="mt-6 rounded-md border bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                <b>Demo:</b> admin@cklass.com / Admin123! · usuario@cklass.com / User123! · jefe@cklass.com / Jefe123! · finanzas@cklass.com / Fin123!
              </div>
            </>
          ) : (
            <PreAltaForm onBack={() => setMode("login")} />
          )}
        </div>
      </div>
    </div>
  );
}

function PreAltaForm({ onBack }: { onBack: () => void }) {
  const sociedades = lsGet<Sociedad[]>(KEYS.sociedades, []);
  const [f, setF] = useState({
    nombre: "", correo: "", rfc: "", banco: "", cuenta: "", clabe: "",
    sociedad: sociedades[0]?.nombre ?? "", password: "", confirm: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.nombre || !f.correo || !f.password) {
      toast.error("Completa los campos obligatorios.");
      return;
    }
    if (f.password !== f.confirm) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    const list = lsGet<unknown[]>(KEYS.prealtas, []);
    list.push({ id: uid("pa_"), ...f, status: "pendiente", created_at: new Date().toISOString() });
    lsSet(KEYS.prealtas, list);
    toast.success("Pre-Alta registrada.");
    onBack();
  };

  return (
    <form onSubmit={submit}>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Regresar
      </button>
      <h2 className="text-lg font-semibold">Pre-Alta de cuenta</h2>
      <p className="mt-1 text-xs text-muted-foreground">Tu solicitud quedará pendiente de aprobación por el administrador.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {([
          ["nombre", "Nombre *"], ["correo", "Correo *"], ["rfc", "RFC"],
          ["banco", "Banco"], ["cuenta", "No. Cuenta"], ["clabe", "CLABE"],
        ] as const).map(([k, l]) => (
          <div key={k}>
            <label className="ckl-label">{l}</label>
            <input className="ckl-input" value={(f as any)[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        <div className="col-span-2">
          <label className="ckl-label">Sociedad</label>
          <select className="ckl-input" value={f.sociedad} onChange={(e) => set("sociedad", e.target.value)}>
            {sociedades.map((s) => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="ckl-label">Contraseña *</label>
          <input type="password" className="ckl-input" value={f.password} onChange={(e) => set("password", e.target.value)} />
        </div>
        <div>
          <label className="ckl-label">Confirmar *</label>
          <input type="password" className="ckl-input" value={f.confirm} onChange={(e) => set("confirm", e.target.value)} />
        </div>
      </div>
      <button type="submit" className="ckl-btn-primary mt-5 w-full justify-center">Enviar Pre-Alta</button>
    </form>
  );
}
