import { useState } from "react";
import { useTonConnectUI } from "@tonconnect/ui-react";
import { Button, HoldButton, Sheet, useToast } from "@/components/ui";
import { api, ApiError } from "@/api/client";
import type { PayoutConfig } from "@/api/hooks";
import { isCancel, runPayout, short, WrongWalletError, type PayoutTx, type PayoutUI } from "@/lib/payoutFlow";

/**
 * «Выплатить» по заявке на вывод — грузится лениво вместе с TON Connect (Касса без него открывается быстрее).
 * Отправляет только с кошелька выплат. Пока прошлый перевод «отправляется», сервер второй не выдаёт (409);
 * обойти это может только владелец — удержанием в шторке.
 */
export default function PayoutButton({
  id,
  config,
  sending,
  disabled,
  onSent,
  onChanged,
}: {
  id: number;
  config: PayoutConfig;
  /** заявка уже «отправляется» — кнопка становится «Отправить ещё раз» */
  sending: boolean;
  disabled?: boolean;
  /** перевод подписан: обновить очередь и запланировать проверку */
  onSent: (tx: PayoutTx) => void;
  /** сервер мог поменять заявку (409: перевод уже нашёлся в сети) — перечитать очередь */
  onChanged: () => void;
}) {
  const [ui] = useTonConnectUI();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [askForce, setAskForce] = useState(false);

  const pay = async (force: boolean) => {
    setAskForce(false);
    setLoading(true);
    setWrong(null);
    setBlocked(null);
    try {
      const tx = await runPayout({
        ui: ui as unknown as PayoutUI,
        payoutWallet: config.payout_wallet,
        payoutWalletRaw: config.payout_wallet_raw ?? "",
        fetchPayload: () => api<PayoutTx>(`/api/v1/withdraw/${id}/tx-payload${force ? "?force=1" : ""}`),
      });
      toast({ kind: "ok", title: "Перевод отправлен", sub: `#${tx.id} · заявка закроется после подтверждения сети` });
      onSent(tx);
    } catch (e) {
      if (e instanceof WrongWalletError) {
        setWrong(e.message);
        return;
      }
      const msg = e instanceof Error ? e.message : "Ошибка";
      if (e instanceof ApiError && e.status === 409) {
        setBlocked(msg);
        onChanged();
        return;
      }
      const cancelled = isCancel(msg);
      toast({ kind: cancelled ? "info" : "danger", title: cancelled ? "Перевод отменён" : "Выплата не ушла", sub: cancelled ? undefined : msg });
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    try {
      await ui.disconnect();
    } catch {
      /* уже отключён */
    }
    setWrong(null);
  };

  return (
    <div className="grid gap-2">
      <Button block size="lg" disabled={disabled || loading} onClick={() => pay(false)}>
        {loading ? "Ожидание кошелька…" : sending ? "Отправить ещё раз" : "Выплатить"}
      </Button>

      {wrong ? (
        <div role="alert" className="grid gap-2 border border-[var(--magenta)] bg-[var(--magenta-soft)] p-3">
          <p className="text-[13px] leading-snug text-[var(--magenta)]">{wrong}</p>
          <Button kind="secondary" size="sm" onClick={disconnect}>
            Отключить кошелёк
          </Button>
        </div>
      ) : null}

      {blocked ? (
        <div role="alert" className="grid gap-2 border border-[var(--amber)] bg-[var(--amber-soft)] p-3">
          <p className="text-[13px] leading-snug text-[var(--amber)]">{blocked}</p>
          {config.is_owner ? (
            <Button kind="ghost" size="sm" onClick={() => setAskForce(true)}>
              Всё равно отправить…
            </Button>
          ) : null}
        </div>
      ) : null}

      <Sheet open={askForce} onClose={() => setAskForce(false)} title="Второй перевод по заявке?">
        <p className="ui-sec text-[15px]">
          По заявке #{id} уже выдан перевод. Если он дошёл, второй уйдёт сверху и вернуть его будет нельзя. Сначала нажмите «Проверить».
        </p>
        <p className="ui-num s-s mt-3 block whitespace-normal text-[var(--text-3)]">с кошелька {short(config.payout_wallet)}</p>
        <div className="mt-5 grid gap-2">
          <HoldButton kind="danger" block disabled={loading} onConfirm={() => pay(true)}>
            Удерживайте — отправить ещё раз
          </HoldButton>
          <Button kind="ghost" block onClick={() => setAskForce(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
