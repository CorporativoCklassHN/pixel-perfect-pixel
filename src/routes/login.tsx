import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  KEYS,
  lsGet,
  lsSet,
  uid,
  generateResetCode,
  resetPasswordWithCode,
  type Sociedad,
} from "@/lib/store";
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
  const [mode, setMode] = useState<"login" | "prealta" | "recuperar">("login");
  const [identifier, setIdentifier] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(identifier, pass)) {
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
                Ingresa con tu RFC o usuario.
              </p>
              <form className="mt-6 space-y-4" onSubmit={handleLogin}>
                <div>
                  <label className="ckl-label">RFC / Usuario</label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    placeholder="RFC / Usuario"
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
                  <button
                    type="button"
                    onClick={() => setMode("recuperar")}
                    className="text-xs"
                    style={{ color: "#444444" }}
                  >
                    ¿Olvidaste la contraseña?
                  </button>
                </div>
                <button type="submit" className="ckl-btn-primary w-full justify-center">Iniciar sesión</button>
              </form>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex-1 border-t" /> o <div className="flex-1 border-t" />
              </div>
              <div className="space-y-2">
                <button onClick={() => setMode("prealta")} className="ckl-btn-ghost w-full justify-center">Pre-Alta</button>
              </div>
              <div className="mt-6 space-y-1 rounded-md border bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                <div className="mb-1 font-semibold text-foreground">Demo (correo o RFC, misma contraseña):</div>
                <div>Admin: admin@cklass.com · PEAL800101AB1 · Admin123!</div>
                <div>Usuario: usuario@cklass.com · TOMM900312EF3 · User123!</div>
                <div>Jefe: jefe@cklass.com · ALAJ750505CD2 · Jefe123!</div>
                <div>Finanzas: finanzas@cklass.com · VEGAL850620GH4 · Fin123!</div>
                <div>Compras: compras@cklass.com · RADI870415KL7 · Compras123!</div>
              </div>
            </>
          ) : mode === "prealta" ? (
            <PreAltaForm onBack={() => setMode("login")} />
          ) : (
            <RecuperarForm onBack={() => setMode("login")} />
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

function RecuperarForm({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"solicitar" | "codigo">("solicitar");
  const [identifier, setIdentifier] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const handleSolicitar = (e: React.FormEvent) => {
    e.preventDefault();
    const result = generateResetCode(identifier);
    if (!result) {
      toast.error("No encontramos una cuenta activa con ese RFC/usuario.");
      return;
    }
    setDemoCode(result.code);
    toast.success(`Código enviado a ${result.user.correo}`);
    setStep("codigo");
  };

  const handleCambiar = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (newPass !== confirmPass) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    if (resetPasswordWithCode(identifier, code, newPass)) {
      toast.success("Contraseña actualizada. Ya puedes iniciar sesión.");
      onBack();
    } else {
      toast.error("Código inválido o expirado.");
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Regresar
      </button>
      <h2 className="text-lg font-semibold">Recuperar contraseña</h2>

      {step === "solicitar" ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Ingresa tu RFC o usuario y te enviaremos un código de un solo uso para restablecer tu
            contraseña.
          </p>
          <form className="mt-4 space-y-4" onSubmit={handleSolicitar}>
            <div>
              <label className="ckl-label">RFC / Usuario</label>
              <input
                className="ckl-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="RFC / Usuario"
              />
            </div>
            <button type="submit" className="ckl-btn-primary w-full justify-center">
              Enviar código
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Ingresa el código de un solo uso y define tu nueva contraseña.
          </p>
          <div className="mt-3 rounded-md border bg-muted px-3 py-2 text-[11px] text-muted-foreground">
            <b>Modo demo:</b> no hay un servicio de correo conectado, así que tu código es{" "}
            <b>{demoCode}</b> (válido 10 minutos, un solo uso).
          </div>
          <form className="mt-4 space-y-4" onSubmit={handleCambiar}>
            <div>
              <label className="ckl-label">Código</label>
              <input
                className="ckl-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="123456"
                maxLength={6}
              />
            </div>
            <div>
              <label className="ckl-label">Nueva contraseña</label>
              <input
                type="password"
                className="ckl-input"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="ckl-label">Confirmar contraseña</label>
              <input
                type="password"
                className="ckl-input"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="ckl-btn-primary w-full justify-center">
              Cambiar contraseña
            </button>
          </form>
        </>
      )}
    </div>
  );
}
