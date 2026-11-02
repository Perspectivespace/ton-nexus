import { THEME, TonConnect, TonConnectUI } from "virtual:tn-payout-tonconnect-ui";
import { PAYOUT_STORAGE_PREFIX, PrefixedStorage } from "./payoutStorage";

/** Своё место в DOM для окна подключения кошелька выплат — не общий #tc-widget-root личной сессии */
export const PAYOUT_WIDGET_ROOT_ID = "tn-payout-widget-root";

let instance: TonConnectUI | null = null;

/**
 * Сессия TON Connect кошелька выплат — одна на приложение, отдельно от личной (Профиль, Пополнение).
 * Хранилище с префиксом `tn-payout:`: подключение или отключение здесь не трогает личный кошелёк.
 */
export function getPayoutTonConnectUI(): TonConnectUI {
  if (instance) return instance;
  if (!document.getElementById(PAYOUT_WIDGET_ROOT_ID)) {
    const root = document.createElement("div");
    root.id = PAYOUT_WIDGET_ROOT_ID;
    document.body.appendChild(root);
  }
  const connector = new TonConnect({
    manifestUrl: `${window.location.origin}/api/v1/wallet/tonconnect-manifest.json`,
    storage: new PrefixedStorage(PAYOUT_STORAGE_PREFIX),
  });
  instance = new TonConnectUI({
    connector,
    widgetRootId: PAYOUT_WIDGET_ROOT_ID,
    uiPreferences: { theme: THEME.DARK, borderRadius: "m" },
    language: "ru",
  });
  return instance;
}
