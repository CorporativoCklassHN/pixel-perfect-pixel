import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { user, cargando } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (cargando) return;
    navigate({ to: user ? "/dashboard" : "/login", replace: true });
  }, [cargando, user, navigate]);

  return null;
}
