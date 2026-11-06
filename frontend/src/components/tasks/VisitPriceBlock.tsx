import { Readout } from "@/components/ui";

export type VisitQuoteView = {
  reward: string;
  payout: string;
  commission: string;
  total: string;
  commission_bp: number;
  slots: number;
};

/** Блок живой цены visit (данные с серверного /quote) */
export function VisitPriceBlock({ quote, loading }: { quote: VisitQuoteView | null; loading?: boolean }) {
  if (loading && !quote) {
    return (
      <div className="ui-cut grid grid-cols-3 gap-2 p-4" aria-busy="true">
        <Readout label="Исполнитель получит" value="…" unit="TON" />
        <Readout label="Комиссия" value="…" unit="TON" />
        <Readout label="К оплате" value="…" unit="TON" />
      </div>
    );
  }
  if (!quote) return null;
  return (
    <div className="ui-cut grid grid-cols-3 gap-2 p-4" data-testid="visit-price">
      <Readout label="Исполнитель получит" value={String(quote.reward)} unit="TON" hint={`×${quote.slots} = ${quote.payout}`} />
      <Readout label="Комиссия" value={String(quote.commission)} unit="TON" hint={`${quote.commission_bp / 100}%`} />
      <Readout label="К оплате" value={String(quote.total)} unit="TON" hint="с баланса при публикации" />
    </div>
  );
}
