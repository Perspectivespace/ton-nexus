import { lazy, Suspense, type ReactNode } from "react";

const Provider = lazy(() =>
  import("@tonconnect/ui-react").then((m) => ({ default: m.TonConnectUIProvider }))
);

/** fallback — что показать, пока грузится чанк TON Connect (по умолчанию ничего) */
export function LazyTonConnectProvider({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const manifestUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/v1/wallet/tonconnect-manifest.json`
    : "/api/v1/wallet/tonconnect-manifest.json";
  return (
    <Suspense fallback={fallback}>
      <Provider
        manifestUrl={manifestUrl}
        uiPreferences={{ theme: "DARK" as any, borderRadius: "m" }}
        language="ru"
      >
        {children}
      </Provider>
    </Suspense>
  );
}
