import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Vercel serves frontend/dist at the site root (outputDirectory), so assets
  // resolve from "/". API calls are proxied to the backend via vercel.json
  // rewrites, so the browser stays same-origin (no CORS / mixed content).
  base: "/",
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Proxy API calls to the FastAPI backend so the browser never needs the
    // MongoDB connection string and we avoid CORS in development.
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
