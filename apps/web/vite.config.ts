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
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime - changes rarely, cache separately
          "react-vendor": ["react", "react-dom"],
          // Router - separate chunk for routing
          "router": ["react-router-dom"],
          // TanStack libraries - query and virtualization
          "tanstack": ["@tanstack/react-query", "@tanstack/react-virtual"],
          // Form handling - react-hook-form + validation
          "form": ["react-hook-form", "@hookform/resolvers", "zod"],
          // UI primitives from Radix - grouped together
          "radix-ui": [
            "@radix-ui/react-avatar",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-dialog",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-slot",
            "@radix-ui/react-tooltip",
          ],
          // State management
          "zustand": ["zustand"],
          // Animation library
          "motion": ["motion"],
          // i18n
          "i18n": ["i18next", "react-i18next"],
        },
      },
    },
  },
}))
