import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    // The console answers on one address whichever way the stack is running:
    // this server binds it during development, and the bundled proxy publishes
    // it when everything runs in containers. Sliding to the next free port on a
    // collision would quietly break that, and with it the origin the API
    // expects, so the collision is an error instead.
    port: Number(process.env.CONSOLE_PORT ?? 4173),
    strictPort: true,
    proxy: {
      "^/api/": {
        target: process.env.OPENRUM_API_PROXY ?? "http://127.0.0.1:8080",
        changeOrigin: false,
      },
      // Lets a page served from the dev server reach ingest on the same origin,
      // which is what keeps the browser's origin equal to PUBLIC_BASE_URL.
      "^/ingest/": {
        target: process.env.OPENRUM_INGEST_PROXY ?? "http://127.0.0.1:8081",
        changeOrigin: false,
      },
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react(), tailwindcss()],
});
