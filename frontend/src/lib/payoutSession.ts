import { createContext, useContext } from "react";
import type { PayoutUI } from "./payoutFlow";

/** Сессия кошелька выплат в Кассе (см. components/PayoutSession) */
export type PayoutSessionValue = {
  ui: PayoutUI & { disconnect: () => Promise<void> };
  /** подключённый кошелёк выплат, raw «0:hex»; null — не подключён */
  address: string | null;
};

export const PayoutSessionContext = createContext<PayoutSessionValue | null>(null);

export function usePayoutSession(): PayoutSessionValue {
  const s = useContext(PayoutSessionContext);
  if (!s) throw new Error("usePayoutSession: нет PayoutSession выше по дереву");
  return s;
}
