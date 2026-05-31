import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // @vercel/static-build serves this app's dist output under "/frontend/"
  // (the directory of frontend/package.json), so asset URLs must use that base.
  base: "/frontend/",
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
