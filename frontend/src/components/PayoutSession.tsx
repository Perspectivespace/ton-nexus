import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toUserFriendlyAddress } from "virtual:tn-payout-tonconnect-ui";
import { useToast } from "@/components/ui";
import type { PayoutConfig } from "@/api/hooks";
import { getPayoutTonConnectUI } from "@/lib/payoutConnect";
import { ensureConnected } from "@/lib/tonconnectFlow";
import { isCancel } from "@/lib/payoutFlow";
import { PayoutSessionContext, type PayoutSessionValue } from "@/lib/payoutSession";
import { PayoutWalletBar } from "./PayoutWalletBar";

function friendlyOf(raw: string | null, testnet: boolean): string | null {
  if (!raw) return null;
  try {
    return toUserFriendlyAddress(raw, testnet);
  } catch {
    return raw;
  }
}

/**
 * Сессия TON Connect кошелька выплат для Кассы (грузится лениво, отдельным чанком).
 * Своя копия @tonconnect/ui и своё хранилище — личный кошелёк в Профиле и Пополнении не затрагивается.
 */
export default function PayoutSession({ config, children }: { config: PayoutConfig; children: ReactNode }) {
  const ui = useMemo(() => getPayoutTonConnectUI(), []);
  const toast = useToast();
  const [address, setAddress] = useState<string | null>(ui.account?.address ?? null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const off = ui.onStatusChange((w) => setAddress(w?.account.address ?? null));
    ui.connectionRestored.then(() => {
      if (!alive) return;
      setAddress(ui.account?.address ?? null);
      setRestored(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, [ui]);

  const connect = async () => {
    setBusy(true);
    try {
      await ensureConnected(ui);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      if (!isCancel(msg)) toast({ kind: "danger", title: "Кошелёк выплат не подключён", sub: msg });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await ui.disconnect();
    } catch {
      /* уже отключён */
    } finally {
      setAddress(null);
      setBusy(false);
    }
  };

  const value = useMemo<PayoutSessionValue>(() => ({ ui: ui as unknown as PayoutSessionValue["ui"], address }), [ui, address]);

  return (
    <PayoutSessionContext.Provider value={value}>
      <PayoutWalletBar
        restored={restored}
        address={address}
        friendly={friendlyOf(address, config.network === "testnet")}
        expected={config.payout_wallet}
        expectedRaw={config.payout_wallet_raw ?? ""}
        busy={busy}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      {children}
    </PayoutSessionContext.Provider>
  );
}
