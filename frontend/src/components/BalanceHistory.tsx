import { useState, type ReactNode } from "react";
import { useBalanceHistory, type HistoryFilter, type HistoryItem } from "@/api/hooks";
import {
  IconCheck,
  IconCoins,
  IconHistory,
  IconIn,
  IconKey,
  IconOut,
  IconReactor,
  IconTasks,
  IconTower,
  IconUp,
  IconWheel,
} from "@/components/icons";
import { Button, EmptyState, ErrorState, List, ListRow, Tabs, Tag, type Tone } from "@/components/ui";

export const HISTORY_FILTERS: ReadonlyArray<{ value: HistoryFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "deposits", label: "Пополнения" },
  { value: "withdrawals", label: "Выводы" },
  { value: "earnings", label: "Начисления" },
  { value: "spending", label: "Траты" },
];

const ICON: Record<string, (p: { size?: number }) => ReactNode> = {
  deposit: IconIn,
  deposit_pending: IconIn,
  withdraw: IconOut,
  withdraw_refund: IconIn,
  task_reward: IconTasks,
  task_budget: IconTasks,
  daily: IconCheck,
  miner: IconReactor,
  upgrade: IconUp,
  wheel: IconWheel,
  promo: IconKey,
  tower_prize: IconTower,
  credit: IconCoins,
  debit: IconCoins,
};

const STATUS_TONE: Record<string, Tone> = { pending: "warn", review: "warn", paid: "ok", rejected: "danger" };

const EMPTY: Record<HistoryFilter, string> = {
  all: "Здесь появятся пополнения, выводы, награды и траты.",
  deposits: "Пополнений пока не было.",
  withdrawals: "Заявок на вывод пока не было.",
  earnings: "Начислений пока не было: майнер, задания, ежедневный бонус.",
  spending: "Трат пока не было: усиления майнера, бюджеты заданий.",
};

export function fmtWhen(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** «+1.5» / «−0.25»: минус — типографский, без лишних нулей */
export function signedAmount(amount: string) {
  const neg = amount.startsWith("-");
  return `${neg ? "−" : "+"}${neg ? amount.slice(1) : amount}`;
}

export function HistoryRow({ item }: { item: HistoryItem }) {
  const neg = item.amount.startsWith("-");
  const pending = item.kind === "deposit_pending";
  const Icon = ICON[item.kind] ?? IconCoins;
  const sub = [fmtWhen(item.created_at), item.detail].filter(Boolean).join(" · ");
  return (
    <ListRow
      icon={<Icon size={20} />}
      iconTone={pending ? "amber" : neg ? "muted" : "neon"}
      title={item.label}
      sub={sub}
      trailing={
        <span className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span
            className={`ui-num whitespace-nowrap text-[15px] leading-5 ${
              neg || pending ? "text-[var(--text-2)]" : "text-[var(--ok)]"
            }`}
          >
            {signedAmount(item.amount)}
          </span>
          {item.status_label ? (
            <Tag tone={STATUS_TONE[item.status ?? ""] ?? "neutral"}>{item.status_label}</Tag>
          ) : item.balance_after != null ? (
            <span className="ui-num whitespace-nowrap text-[11px] leading-4 text-[var(--text-2)]">
              остаток {item.balance_after}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

/** Шторка «История»: вся история баланса с фильтром, догрузкой и пустым состоянием */
export function BalanceHistorySheet({ initialFilter = "all" }: { initialFilter?: HistoryFilter }) {
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter);
  const q = useBalanceHistory(filter);
  const pages = q.data?.pages ?? [];
  const pending = pages[0]?.pending ?? [];
  const items = pages.flatMap((p) => p.items);
  const rows = [...pending, ...items];

  return (
    <div className="space-y-3">
      <Tabs kind="line" label="Тип операций" items={HISTORY_FILTERS} value={filter} onChange={setFilter} />
      {q.isLoading ? (
        <p className="ui-sec" aria-busy="true">
          Загрузка…
        </p>
      ) : q.isError ? (
        <ErrorState title="История не загрузилась" message={q.error instanceof Error ? q.error.message : undefined} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconHistory size={32} />} title="Операций нет" body={EMPTY[filter]} />
      ) : (
        <>
          <List>
            {rows.map((it) => (
              <HistoryRow key={String(it.id)} item={it} />
            ))}
          </List>
          {q.hasNextPage ? (
            <Button kind="secondary" block disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Загрузка…" : "Загрузить ещё"}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

