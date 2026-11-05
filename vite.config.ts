import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command, mode }) => {
  // Expose .env / .env.local to server code (process.env) in dev; Vite only does this for VITE_*.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
    process.env[k] ??= v;
  }
  return {
    server: {
      // La API (Express) corre aparte en el puerto 3001; en desarrollo Vite le reenvía /api.
      proxy: { "/api": { target: `http://127.0.0.1:${process.env.API_PORT || 3001}` } },
    },
    resolve: {
      dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
    },
    plugins: [
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tailwindcss(),
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      tanstackStart({ server: { entry: "server" } }),
      viteReact(),
      // Nitro only for production builds, targeting a Node server.
      ...(command === "build"
        ? [
            nitro({
              preset: "node-server",
              routeRules: {
                "/api/**": { proxy: `http://127.0.0.1:${process.env.API_PORT || 3001}/api/**` },
              },
            }),
          ]
        : []),
    ],
  };
});
