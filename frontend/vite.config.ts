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
    rollupOptions: {
      output: {
        // библиотеки — отдельными долгоживущими чанками: при деплое меняется код приложения, а не они (кэш в WebView живёт).
        // Анимации (framer-motion) и запасной Telegram SDK в стартовую загрузку не входят — их тянут только разделы / запасной путь.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return "vendor-router";
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "vendor-query";
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "vendor-motion";
          if (/[\\/]node_modules[\\/]@twa-dev[\\/]/.test(id)) return "tg-sdk";
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
