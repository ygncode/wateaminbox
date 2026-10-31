import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

// Load the app stylesheet without blocking the first paint. A plain
// <link rel="stylesheet"> is render-blocking, so on a cold visit the browser
// paints NOTHING - not even the inline #root splash - until that CSS has
// downloaded; on a slow link that is seconds of blank screen before the loading
// spinner can appear. Swapping it to preload-then-apply lets the inline splash
// paint as soon as the HTML is parsed. This is FOUC-safe for this app: the
// stylesheet is far smaller than the JS entry and is fetched at the same time,
// so it is always applied before React mounts and swaps the splash for the
// skeleton. The <noscript> keeps styling for scripting-disabled clients.
function asyncAppCss(): Plugin {
  return {
    name: "async-app-css",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)href="([^"]+\.css)"([^>]*)>/g,
        (_match, pre, href, post) =>
          `<link rel="preload" as="style"${pre}href="${href}"${post} onload="this.onload=null;this.rel='stylesheet'">` +
          `<noscript><link rel="stylesheet"${pre}href="${href}"${post}></noscript>`,
      )
    },
  }
}

// The app is one entry chunk plus lazy route chunks. Without a hint the browser
// cannot discover the route chunk until the entry has downloaded, parsed, and
// the router has matched - so the landing route (the chat inbox, where returning
// users almost always go) downloads strictly AFTER the entry, a serial
// waterfall on the cold first visit. Emitting a modulepreload for that chunk in
// the HTML head lets the browser fetch it in parallel with the entry instead.
// Build-only: it reads the hashed chunk name from the finished bundle. If the
// chunk is ever not found the hook is a no-op, so a rename degrades to today's
// behaviour rather than breaking.
function preloadLandingRoute(moduleIdSuffix: string): Plugin {
  return {
    name: "preload-landing-route",
    apply: "build",
    transformIndexHtml(html, ctx) {
      const bundle = ctx.bundle
      if (!bundle) return html
      const chunk = Object.values(bundle).find(
        (output) =>
          output.type === "chunk" &&
          output.isDynamicEntry &&
          output.facadeModuleId?.endsWith(moduleIdSuffix),
      )
      if (!chunk || chunk.type !== "chunk") return html
      return {
        html,
        tags: [
          {
            tag: "link",
            attrs: {
              rel: "modulepreload",
              // Module scripts fetch with CORS; match it so the preload is
              // reused for the real import instead of fetched twice.
              crossorigin: "",
              href: `/${chunk.fileName}`,
            },
            injectTo: "head",
          },
        ],
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    preloadLandingRoute("/pages/ChatPage.tsx"),
    asyncAppCss(),
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
