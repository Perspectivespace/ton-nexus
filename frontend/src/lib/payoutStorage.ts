/**
 * Отдельная сессия TON Connect для выплат (Касса).
 *
 * Личный кошелёк (Профиль, Пополнение) живёт в общей сессии @tonconnect/ui-react — она одна на приложение.
 * Кошелёк выплат — свой экземпляр @tonconnect/ui со своим хранилищем: все ключи с префиксом `tn-payout:`,
 * поэтому подключение и отключение в Кассе не трогает личную сессию, и наоборот.
 *
 * Модуль без зависимостей от браузера и TON Connect: его же использует vite.config.ts.
 */

export const PAYOUT_STORAGE_PREFIX = "tn-payout:";

/** Виртуальный модуль: вторая копия @tonconnect/ui со своим состоянием (см. vite.config.ts) */
export const PAYOUT_UI_MODULE = "virtual:tn-payout-tonconnect-ui";
/** Суффикс id второй копии — по нему сборщик держит её отдельным модулем */
export const PAYOUT_UI_QUERY = "?tn-payout";

/** Ключи, которые @tonconnect/ui пишет в localStorage напрямую, мимо хранилища sdk */
export const TONCONNECT_UI_KEYS = [
  "ton-connect-ui_wallet-info",
  "ton-connect-ui_preferred-wallet",
  "ton-connect-ui_last-selected-wallet-info",
] as const;

/** То же, что IStorage из @tonconnect/sdk */
export type KeyValueStorage = {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};

type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Хранилище sdk с префиксом ключей поверх localStorage */
export class PrefixedStorage implements KeyValueStorage {
  constructor(
    readonly prefix: string = PAYOUT_STORAGE_PREFIX,
    private readonly backend?: SyncStorage,
  ) {}

  private get store(): SyncStorage {
    return this.backend ?? globalThis.localStorage;
  }

  async setItem(key: string, value: string) {
    this.store.setItem(this.prefix + key, value);
  }

  async getItem(key: string) {
    return this.store.getItem(this.prefix + key);
  }

  async removeItem(key: string) {
    this.store.removeItem(this.prefix + key);
  }
}

/**
 * Переписать ключи localStorage в исходнике @tonconnect/ui (для второй копии).
 * Если после обновления библиотеки ключ не найден ровно один раз — сборка падает, а не делит сессию молча.
 */
export function prefixTonConnectUiKeys(code: string, prefix: string = PAYOUT_STORAGE_PREFIX): string {
  let out = code;
  for (const key of TONCONNECT_UI_KEYS) {
    const literal = `"${key}"`;
    const count = out.split(literal).length - 1;
    if (count !== 1) {
      throw new Error(`@tonconnect/ui: ключ ${key} найден ${count} раз(а), ожидался 1 — проверьте prefixTonConnectUiKeys`);
    }
    out = out.replace(literal, `"${prefix}${key}"`);
  }
  return out;
}
