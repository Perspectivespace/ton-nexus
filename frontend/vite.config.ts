import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createRequire } from "module";
import type { Plugin } from "vite";
import { PAYOUT_UI_MODULE, PAYOUT_UI_QUERY, prefixTonConnectUiKeys } from "./src/lib/payoutStorage";

/**
 * Касса подключает кошелёк выплат отдельно от личного кошелька. @tonconnect/ui держит состояние на уровне модуля
 * (одно окно подключения, один connector), поэтому для выплат берём вторую копию модуля — тот же файл с суффиксом
 * в id — и переписываем её ключи localStorage на префикс `tn-payout:`.
 */
function payoutTonConnect(): Plugin {
  // ESM-вход пакета (lib/index.mjs) рядом с CJS-входом, который отдаёт require.resolve
  const uiEntry = path.join(path.dirname(createRequire(import.meta.url).resolve("@tonconnect/ui")), "index.mjs");
  return {
    name: "tn-payout-tonconnect-ui",
    enforce: "pre",
    resolveId(id) {
      if (id === PAYOUT_UI_MODULE) return uiEntry + PAYOUT_UI_QUERY;
    },
    transform(code, id) {
      if (id.endsWith(PAYOUT_UI_QUERY)) return { code: prefixTonConnectUiKeys(code), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), payoutTonConnect()],
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
          // вторая копия @tonconnect/ui (кошелёк выплат) — только Касса
          if (id.endsWith(PAYOUT_UI_QUERY)) return "vendor-tonconnect-payout";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return "vendor-router";
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "vendor-query";
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "vendor-motion";
          if (/[\\/]node_modules[\\/]@twa-dev[\\/]/.test(id)) return "tg-sdk";
          // TON Connect — только по требованию (шторки «Кошелёк» и «Пополнение»), не в чанке Wallet
          if (/[\\/]node_modules[\\/](@tonconnect|solid-js|ua-parser-js|deepmerge)[\\/]/.test(id)) return "vendor-tonconnect";
        },
      },
    },
  },
  optimizeDeps: {
    // вторая копия @tonconnect/ui в dev грузится как есть, а её зависимости (часть — CommonJS) должны быть пребандлены
    include: ["@tonconnect/sdk", "classnames", "deepmerge", "ua-parser-js"],
  },
  server: {
    port: 5173,
    host: true,
  },
});
