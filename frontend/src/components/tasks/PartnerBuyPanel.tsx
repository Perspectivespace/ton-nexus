import { StatusPill } from "@/components/ui";

export type PartnerBuyState = {
  status: string;
  price: string;
  slotsLeft: number;
  minLevel: number;
  myLevel: number;
  myBalance: string | null;
  isPartner: boolean;
  purchased: boolean;
  pending: boolean;
  error: string | null;
};

function fmt(v: string | number) {
  return String(Number(v));
}

/** Почему купить нельзя (null — можно) */
export function buyBlockReason(s: PartnerBuyState): string | null {
  if (s.purchased) return null;
  if (s.isPartner) return "Это ваша услуга, купить её нельзя.";
  if (s.status !== "active") return "Продажи сейчас закрыты.";
  if (s.slotsLeft <= 0) return "Продажи закончились.";
  if (s.myLevel < s.minLevel) return `Нужен уровень ${s.minLevel}.`;
  if (s.myBalance != null && Number(s.myBalance) < Number(s.price))
    return `Не хватает TON: нужно ${fmt(s.price)}, на балансе ${fmt(s.myBalance)}.`;
  return null;
}

/** Блок покупки партнёрской услуги для исполнителя-покупателя */
export function PartnerBuyPanel({ state, onBuy }: { state: PartnerBuyState; onBuy: () => void }) {
  const reason = buyBlockReason(state);
  const canBuy = !state.purchased && reason == null;
  return (
    <div className="ui-cut space-y-4 p-5" data-testid="partner-buy">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Покупка</p>
        <StatusPill tone={state.purchased ? "ok" : canBuy ? "live" : "neutral"}>
          {state.purchased ? "куплено" : canBuy ? "доступно" : "недоступно"}
        </StatusPill>
      </div>

      {state.purchased ? (
        <p className="text-[13px] leading-relaxed">
          Покупка оплачена с баланса. Партнёр получил оплату, детали в истории кошелька.
        </p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
            {reason ?? "Сумма спишется с вашего баланса в приложении и сразу уйдёт партнёру."}
          </p>
          <button
            type="button"
            className="ui-btn primary block"
            disabled={!canBuy || state.pending}
            onClick={onBuy}
          >
            {state.pending ? "Оплата…" : `Купить за ${fmt(state.price)} TON`}
          </button>
        </>
      )}

      {state.error && <p className="text-[12px] text-[var(--danger-text)]">{state.error}</p>}
    </div>
  );
}
