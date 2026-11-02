import { Button } from "@/components/ui";
import { sameWallet, short } from "@/lib/payoutFlow";

/**
 * «Кошелёк выплат» над заявками Кассы: какой кошелёк подключён к сессии выплат, подключить / отключить.
 * Это отдельная сессия — личный кошелёк в Профиле она не видит и не трогает.
 */
export function PayoutWalletBar({
  restored,
  address,
  friendly,
  expected,
  expectedRaw,
  busy,
  onConnect,
  onDisconnect,
}: {
  /** сессия восстановлена из хранилища (до этого — «Загрузка…») */
  restored: boolean;
  /** подключённый кошелёк, raw «0:hex» */
  address: string | null;
  /** он же в виде UQ… */
  friendly: string | null;
  /** кошелёк выплат из настроек: UQ… и raw */
  expected: string;
  expectedRaw: string;
  busy?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = !!address;
  const match = connected && sameWallet(address, expectedRaw);
  const state = !restored ? "Загрузка…" : !connected ? "не подключён" : match ? "подключён" : "подключён другой";

  return (
    <section className="ui-cut space-y-3 p-4" aria-label="Кошелёк выплат" data-testid="payout-wallet-bar">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-medium text-[var(--text)]">Кошелёк выплат: {state}</p>
        {restored && connected ? (
          <span className={`mono shrink-0 text-[12px] ${match ? "text-[var(--accent)]" : "text-[var(--magenta)]"}`}>
            {short(friendly ?? address ?? "")}
          </span>
        ) : null}
      </div>

      {restored && !connected ? (
        <p className="text-[13px] leading-snug text-[var(--text-2)]">
          Подключите кошелёк выплат <span className="mono">{short(expected)}</span>. Это отдельное подключение только для Кассы —
          кошелёк в Профиле оно не меняет.
        </p>
      ) : null}

      {restored && connected && !match ? (
        <p role="alert" className="border border-[var(--magenta)] bg-[var(--magenta-soft)] p-3 text-[13px] leading-snug text-[var(--magenta)]">
          Это не кошелёк выплат. Отключите его и подключите {short(expected)}.
        </p>
      ) : null}

      {restored ? (
        connected ? (
          <Button kind={match ? "ghost" : "secondary"} size="sm" block disabled={busy} onClick={onDisconnect}>
            Отключить
          </Button>
        ) : (
          <Button kind="secondary" size="sm" block disabled={busy} onClick={onConnect}>
            Подключить кошелёк выплат
          </Button>
        )
      ) : null}
    </section>
  );
}
