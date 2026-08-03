import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Conditionally add visualizer plugin when ANALYZE=true
    // Usage: ANALYZE=true bun run build
    mode === "production" && process.env.ANALYZE === "true" && import("rollup-plugin-visualizer").then(m =>
      m.visualizer({
        filename: "stats.html",
        open: true,
        gzipSize: true,
        brotliSize: true,
      })
    ),
  ].filter(Boolean),
  server: {
    port: 4444,
  },
  preview: {
    port: 4444,
  },
  resolve: {
    // Workspace-local installs can otherwise split React from React DOM.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Let Rollup derive the chunk graph. Manually separating ReactDOM, Radix,
  // and TanStack creates a production-only circular chunk dependency with
  // React 19, leaving React's Activity export undefined during evaluation.
}))
