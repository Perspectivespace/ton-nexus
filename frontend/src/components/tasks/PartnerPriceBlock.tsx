import { Readout } from "@/components/ui";
import { t } from "@/i18n";

export type PartnerQuoteView = {
  /** цена для покупателя */
  total: string;
  /** партнёру */
  payout: string;
  /** платформе */
  commission: string;
  commission_bp: number;
};

/** Разбивка цены партнёрской услуги (данные с серверного /quote или задания) */
export function PartnerPriceBlock({ quote, loading }: { quote: PartnerQuoteView | null; loading?: boolean }) {
  if (loading && !quote) {
    return (
      <div className="ui-cut grid grid-cols-3 gap-2 p-4" aria-busy="true">
        <Readout label={t("partner.buyerPays")} value="…" unit="TON" />
        <Readout label={t("partner.partnerGets")} value="…" unit="TON" />
        <Readout label={t("partner.fee")} value="…" unit="TON" />
      </div>
    );
  }
  if (!quote) return null;
  return (
    <div className="ui-cut grid grid-cols-3 gap-2 p-4" data-testid="partner-price">
      <Readout label={t("partner.buyerPays")} value={String(quote.total)} unit="TON" hint={t("partner.fromBalance")} />
      <Readout label={t("partner.partnerGets")} value={String(quote.payout)} unit="TON" />
      <Readout label={t("partner.fee")} value={String(quote.commission)} unit="TON" hint={t("partner.feePct", { commissionBp: quote.commission_bp / 100 })} />
    </div>
  );
}
