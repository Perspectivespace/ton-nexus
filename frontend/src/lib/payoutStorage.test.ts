import { describe, expect, it } from "vitest";
// исходник, из которого vite.config.ts собирает копию для выплат
import uiSource from "../../node_modules/@tonconnect/ui/lib/index.mjs?raw";
import { PAYOUT_STORAGE_PREFIX, PrefixedStorage, TONCONNECT_UI_KEYS, prefixTonConnectUiKeys } from "./payoutStorage";

/** localStorage одного браузера: обе сессии пишут в него */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

// ключ, под которым @tonconnect/sdk хранит подключение (через IStorage)
const SDK_KEY = "ton-connect-storage_bridge-connection";
const PERSONAL = JSON.stringify({ type: "http", wallet: "личный" });
const PAYOUT = JSON.stringify({ type: "http", wallet: "выплат" });

describe("Касса: своя сессия TON Connect для выплат", () => {
  it("личная и выплатная сессии пишут под разными ключами", async () => {
    const ls = memoryStorage();
    ls.setItem(SDK_KEY, PERSONAL); // личная сессия (ui-react, без префикса)
    const payout = new PrefixedStorage(PAYOUT_STORAGE_PREFIX, ls);
    await payout.setItem(SDK_KEY, PAYOUT);

    expect(PAYOUT_STORAGE_PREFIX).toBe("tn-payout:");
    expect([...ls.map.keys()].sort()).toEqual(["tn-payout:" + SDK_KEY, SDK_KEY]);
    expect(ls.getItem(SDK_KEY)).toBe(PERSONAL);
    expect(await payout.getItem(SDK_KEY)).toBe(PAYOUT);
  });

  it("отключение кошелька выплат не трогает личную сессию", async () => {
    const ls = memoryStorage();
    ls.setItem(SDK_KEY, PERSONAL);
    for (const k of TONCONNECT_UI_KEYS) ls.setItem(k, "личный");
    const payout = new PrefixedStorage(PAYOUT_STORAGE_PREFIX, ls);
    await payout.setItem(SDK_KEY, PAYOUT);

    await payout.removeItem(SDK_KEY); // так sdk стирает подключение при disconnect()

    expect(await payout.getItem(SDK_KEY)).toBeNull();
    expect(ls.getItem(SDK_KEY)).toBe(PERSONAL);
    for (const k of TONCONNECT_UI_KEYS) expect(ls.getItem(k)).toBe("личный");
  });

  it("личная сессия не видит кошелёк выплат, и наоборот", async () => {
    const ls = memoryStorage();
    const payout = new PrefixedStorage(PAYOUT_STORAGE_PREFIX, ls);
    await payout.setItem(SDK_KEY, PAYOUT);
    expect(ls.getItem(SDK_KEY)).toBeNull();

    ls.setItem(SDK_KEY, PERSONAL);
    ls.removeItem(SDK_KEY); // отключили личный кошелёк в Профиле
    expect(await payout.getItem(SDK_KEY)).toBe(PAYOUT);
  });

  it("копия @tonconnect/ui пишет свои ключи localStorage с префиксом", () => {
    const src = uiSource;
    const out = prefixTonConnectUiKeys(src);
    for (const k of TONCONNECT_UI_KEYS) {
      expect(src).toContain(`"${k}"`);
      expect(out).not.toContain(`"${k}"`);
      expect(out).toContain(`"tn-payout:${k}"`);
    }
  });

  it("ключ не найден (библиотеку обновили) — ошибка, а не общая сессия", () => {
    expect(() => prefixTonConnectUiKeys(`localStorage.setItem("ton-connect-ui_wallet-info", x)`)).toThrow(/ton-connect-ui_preferred-wallet/);
    const twice = TONCONNECT_UI_KEYS.map((k) => `"${k}"`).join(";") + `;"${TONCONNECT_UI_KEYS[0]}"`;
    expect(() => prefixTonConnectUiKeys(twice)).toThrow(/2 раз/);
  });
});
