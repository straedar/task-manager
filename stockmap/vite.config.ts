import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/stockmap-app/",
  server: {
    host: true,
    port: 5174,
    proxy: {
      "/stockmap-api": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stockmap-api/, "/api"),
      },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
