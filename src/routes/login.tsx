import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { KEYS, lsGet, lsSet, uid, type Sociedad } from "@/lib/store";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Portal de Viáticos CKL" },
      { name: "description", content: "Acceso al portal corporativo de viáticos Grupo Cklass." },
    ],
  }),
  component: LoginPage,
});

function NodesCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const resize = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);
    type Node = { x: number; y: number; vx: number; vy: number };
    const nodes: Node[] = Array.from({ length: 22 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const max = 160 * window.devicePixelRatio;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = n.x - m.x, dy = n.y - m.y;
          const d = Math.hypot(dx, dy);
          if (d < max) {
            const alpha = (1 - d / max) * 0.5;
            ctx.strokeStyle = `rgba(227,6,19,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = "rgba(227,6,19,0.55)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

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
    <div className="flex min-h-screen">
      {/* LEFT */}
      <div className="relative hidden flex-1 overflow-hidden lg:flex" style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e 50%, #0f3460)" }}>
        <NodesCanvas />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 text-white">
          <div>
            <span className="ckl-logo text-2xl">CKL</span>
          </div>
          <div className="max-w-lg">
            <h1 className="font-serif text-5xl leading-tight">
              Optimiza tus viajes <br /> de trabajo y <span style={{ color: "#E30613" }}>gastos.</span>
            </h1>
            <p className="mt-4 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
              Plataforma única para solicitar, autorizar y comprobar viáticos
              en todas las sociedades del grupo.
            </p>

            <div className="mt-10 grid grid-cols-3 gap-3">
              <div className="col-span-2 rounded-xl border p-4" style={{ background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)" }}>
                <div className="text-[11px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.6)" }}>Resumen del tablero</div>
                <div className="mt-2 flex items-end gap-1 h-10">
                  {[40, 65, 50, 80, 35, 70, 55].map((h, i) => (
                    <div key={i} style={{ height: `${h}%`, width: 10, background: "#E30613", borderRadius: 2, opacity: 0.7 + (h / 300) }} />
                  ))}
                </div>
                <div className="mt-2 flex gap-4 text-xs">
                  <span><b className="text-white">$48K</b> <span style={{ color: "rgba(255,255,255,0.5)" }}>mes</span></span>
                  <span><b className="text-white">5</b> <span style={{ color: "rgba(255,255,255,0.5)" }}>atrasados</span></span>
                </div>
              </div>
              <div className="rounded-xl border p-4" style={{ background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)" }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.6)" }}>Política</div>
                <div className="mt-1 text-2xl font-bold">78%</div>
                <div className="mt-1 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }}>
                  <div className="h-full rounded-full" style={{ width: "78%", background: "#E30613" }} />
                </div>
              </div>
              <div className="col-span-3 rounded-xl border p-4" style={{ background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>20 pendientes por autorizar</span>
                  <span className="ckl-badge" style={{ background: "#E30613", color: "white" }}>Acción</span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>© {new Date().getFullYear()} Grupo Cklass. Todos los derechos reservados.</p>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex w-full flex-col items-center justify-center bg-background px-6 py-10 lg:w-[480px]">
        <div className="w-full max-w-md rounded-[18px] bg-white p-8 shadow-[0_8px_48px_rgba(0,0,0,0.12)]">
          <div className="mb-6 flex justify-center">
            <span className="ckl-logo text-3xl">CKL</span>
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
                <button className="ckl-btn-outline w-full justify-center">Crear nueva cuenta</button>
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
