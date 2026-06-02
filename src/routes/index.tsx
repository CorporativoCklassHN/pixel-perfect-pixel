import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const user = window.localStorage.getItem("ckl_user");
      throw redirect({ to: user ? "/dashboard" : "/login" });
    }
    throw redirect({ to: "/login" });
  },
});
