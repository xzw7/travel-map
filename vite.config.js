import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/travel-map/",
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ["leaflet"],
          gsap: ["gsap"],
          ogl: ["ogl"],
          exifr: ["exifr"],
        },
      },
    },
  },
});
