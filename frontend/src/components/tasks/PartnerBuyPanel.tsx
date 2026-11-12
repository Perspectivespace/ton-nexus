import { StatusPill } from "@/components/ui";
import { t } from "@/i18n";

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
  if (s.isPartner) return t("partner.yours");
  if (s.status !== "active") return t("partner.closed");
  if (s.slotsLeft <= 0) return t("partner.soldOut");
  if (s.myLevel < s.minLevel) return t("partner.needLevel", { minLevel: s.minLevel });
  if (s.myBalance != null && Number(s.myBalance) < Number(s.price))
    return t("partner.noTon", { price: fmt(s.price), myBalance: fmt(s.myBalance) });
  return null;
}

/** Блок покупки партнёрской услуги для исполнителя-покупателя */
export function PartnerBuyPanel({ state, onBuy }: { state: PartnerBuyState; onBuy: () => void }) {
  const reason = buyBlockReason(state);
  const canBuy = !state.purchased && reason == null;
  return (
    <div className="ui-cut space-y-4 p-5" data-testid="partner-buy">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{t("partner.purchase")}</p>
        <StatusPill tone={state.purchased ? "ok" : canBuy ? "live" : "neutral"}>
          {state.purchased ? t("partner.bought") : canBuy ? t("partner.available") : t("partner.unavailable")}
        </StatusPill>
      </div>

      {state.purchased ? (
        <p className="text-[13px] leading-relaxed">
          {t("partner.paid")}</p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
            {reason ?? t("partner.note")}
          </p>
          <button
            type="button"
            className="ui-btn primary block"
            disabled={!canBuy || state.pending}
            onClick={onBuy}
          >
            {state.pending ? t("partner.paying") : t("partner.buyFor", { price: fmt(state.price) })}
          </button>
        </>
      )}

      {state.error && <p className="text-[12px] text-[var(--danger-text)]">{state.error}</p>}
    </div>
  );
}
