import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import agents from "agents/vite";

export default defineConfig({
  plugins: [agents(), react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        ws: false
      },
      "/agents": {
        target: "http://localhost:8787",
        ws: true
      }
    }
  }
});
