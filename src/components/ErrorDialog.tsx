import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

type Listener = (message: string) => void;

let listener: Listener | null = null;

// Reemplaza toast.error(...) en toda la app: los toasts se desvanecen solos y
// algunos usuarios no alcanzan a leerlos. showErrorDialog() se llama igual que
// toast.error() (una función simple, sin hooks), pero bloquea la pantalla con
// un diálogo centrado que solo se cierra al presionar "OK".
export function showErrorDialog(message: string) {
  listener?.(message);
}

export function ErrorDialogHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    listener = (m) => setMessage(m);
    return () => {
      listener = null;
    };
  }, []);

  if (!message) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="ckl-card w-full max-w-sm p-6 text-center">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "#FEE9EA", color: "#E30613" }}
        >
          <AlertCircle size={24} />
        </div>
        <p className="mt-4 text-sm font-medium">{message}</p>
        <button
          onClick={() => setMessage(null)}
          className="ckl-btn-primary mt-5 w-full justify-center"
          autoFocus
        >
          OK
        </button>
      </div>
    </div>
  );
}
