import { lazy, Suspense } from "react";

const TonConnectUIProvider = lazy(() =>
  import("@tonconnect/ui-react").then((m) => ({ default: m.TonConnectUIProvider }))
);

export function LazyTonConnectProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <TonConnectUIProvider manifestUrl="/api/v1/wallet/tonconnect-manifest.json">
        {children}
      </TonConnectUIProvider>
    </Suspense>
  );
}

export async function openTonConnectModal(payload: string) {
  const { TonConnectUI } = await import("@tonconnect/ui-react");
  // Helper used by the wallet sheet; actual UI instance is created inside the sheet.
  return { TonConnectUI, payload };
}
