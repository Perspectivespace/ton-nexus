import { lazy, Suspense, type ReactNode } from "react";

const Provider = lazy(() =>
  import("@tonconnect/ui-react").then((m) => ({ default: m.TonConnectUIProvider }))
);

export function LazyTonConnectProvider({ children }: { children: ReactNode }) {
  const manifestUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/v1/wallet/tonconnect-manifest.json`
    : "/api/v1/wallet/tonconnect-manifest.json";
  return (
    <Suspense fallback={null}>
      <Provider manifestUrl={manifestUrl}>
        {children}
      </Provider>
    </Suspense>
  );
}
