import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Separate entry point: never included in the product build or deployed.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: { "@": path.resolve(import.meta.dirname, "../../../apps/web/src") },
  },
  build: {
    outDir: "/tmp/wateaminbox-chat-pagination-browser",
    emptyOutDir: false,
  },
  preview: { host: "127.0.0.1", port: 4464, strictPort: true },
});
