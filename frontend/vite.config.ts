import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :8010 and Vite proxies /api to it, so the browser sees one origin.
const api = process.env.VITE_API_PROXY ?? "http://localhost:8010";

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; VITE_BASE sets that prefix at build time.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/api", "/mcp", "/docs", "/openapi.json", "/health"].map((p) => [p, { target: api, changeOrigin: true }])),
  },
  build: { target: "es2022", sourcemap: false },
});
