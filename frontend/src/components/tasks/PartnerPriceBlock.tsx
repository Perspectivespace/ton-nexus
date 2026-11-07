import { Readout } from "@/components/ui";

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
        <Readout label="Покупатель платит" value="…" unit="TON" />
        <Readout label="Партнёр получит" value="…" unit="TON" />
        <Readout label="Комиссия" value="…" unit="TON" />
      </div>
    );
  }
  if (!quote) return null;
  return (
    <div className="ui-cut grid grid-cols-3 gap-2 p-4" data-testid="partner-price">
      <Readout label="Покупатель платит" value={String(quote.total)} unit="TON" hint="с баланса в приложении" />
      <Readout label="Партнёр получит" value={String(quote.payout)} unit="TON" />
      <Readout label="Комиссия" value={String(quote.commission)} unit="TON" hint={`${quote.commission_bp / 100}% платформе`} />
    </div>
  );
}
