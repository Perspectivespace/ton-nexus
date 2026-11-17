import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/index.css";
import { initTelegram, telegramReady } from "./lib/telegram";
import { initTheme } from "./lib/theme";
import { initRoutePrefetch } from "./lib/routes";
import { initFps } from "./lib/fps";
import { initVersionCheck } from "./lib/version";
import { LangRoot, getLang } from "./i18n";
import { initErrorReporting } from "./lib/errorReport";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

function boot() {
  initErrorReporting();
  initTelegram();
  initTheme();
  initRoutePrefetch();
  initFps();
  initVersionCheck();
  document.documentElement.lang = getLang();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <LangRoot>
            <App />
          </LangRoot>
        </QueryClientProvider>
      </AppErrorBoundary>
    </StrictMode>
  );
}

// обычно WebApp уже есть (скрипт Telegram в index.html) — запуск синхронный, как раньше
const waiting = telegramReady();
if (waiting) void waiting.then(boot);
else boot();
