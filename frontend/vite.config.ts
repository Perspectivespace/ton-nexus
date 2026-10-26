import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    // шрифты не встраиваем в CSS как base64: браузер сам скачает только нужные поднаборы (кириллица/латиница)
    // спрайты бортов (assets/craft) — отдельными файлами: грузятся только когда город их рисует
    assetsInlineLimit: (file) => (/\.(woff2?|ttf)$/.test(file) || /assets[\\/]craft[\\/]/.test(file) ? false : undefined),
  },
  server: {
    port: 5173,
    host: true,
  },
});
