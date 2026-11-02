import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BalanceHistorySheet, HistoryRow, signedAmount } from "./BalanceHistory";
import type { HistoryItem, HistoryPage } from "@/api/hooks";

const base = { detail: null, balance_after: "10", created_at: "2026-11-01T12:00:00+00:00", status: null, status_label: null };
const deposit: HistoryItem = { ...base, id: 5, kind: "deposit", group: "deposits", label: "Пополнение TON", amount: "2.5" };
const withdraw: HistoryItem = {
  ...base,
  id: 4,
  kind: "withdraw",
  group: "withdrawals",
  label: "Вывод TON",
  amount: "-1.5",
  detail: "Заявка #3",
  status: "pending",
  status_label: "в обработке",
};
const pendingDep: HistoryItem = {
  ...base,
  id: "dep-9",
  kind: "deposit_pending",
  group: "deposits",
  label: "Пополнение TON",
  amount: "0.05",
  balance_after: null,
  detail: "Меньше минимума",
  status: "review",
  status_label: "на проверке",
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function render(page: HistoryPage | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  if (page) qc.setQueryData(["balance", "history", "all"], { pages: [page], pageParams: [null] });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <BalanceHistorySheet />
    </QueryClientProvider>,
  );
  return { html, t: text(html) };
}

describe("История баланса", () => {
  it("знак суммы: плюс для начислений, типографский минус для списаний", () => {
    expect(signedAmount("2.5")).toBe("+2.5");
    expect(signedAmount("-1.5")).toBe("−1.5");
  });

  it("фильтры, строки, статус вывода, остаток и ожидающее пополнение сверху", () => {
    const { html, t } = render({ items: [deposit, withdraw], next_cursor: null, pending: [pendingDep] });
    for (const f of ["Все", "Пополнения", "Выводы", "Начисления", "Траты"]) expect(t).toContain(f);
    expect(t).toContain("+2.5");
    expect(t).toContain("−1.5");
    expect(t).toContain("в обработке");
    expect(t).toContain("Заявка #3");
    expect(t).toContain("остаток 10");
    expect(t).toContain("на проверке");
    expect(t.indexOf("на проверке")).toBeLessThan(t.indexOf("+2.5"));
    expect(html).toContain("text-[var(--ok)]");
    expect(t).not.toContain("Загрузить ещё");
  });

  it("есть следующая страница — кнопка «Загрузить ещё»", () => {
    const { t } = render({ items: [deposit], next_cursor: 5, pending: [] });
    expect(t).toContain("Загрузить ещё");
  });

  it("пустая история — пустое состояние", () => {
    const { t } = render({ items: [], next_cursor: null, pending: [] });
    expect(t).toContain("Операций нет");
  });

  it("строка списания приглушена, без зелёного", () => {
    const html = renderToStaticMarkup(<HistoryRow item={{ ...withdraw, status: "paid", status_label: "выплачено" }} />);
    expect(html).not.toContain("text-[var(--ok)]");
    expect(text(html)).toContain("выплачено");
  });
});

describe("выплаченный вывод — ссылка на перевод", () => {
  it("tx_url → ссылка tonviewer, «отправляется» — свой статус", () => {
    const paid = { ...withdraw, status: "paid", status_label: "выплачено", tx_url: "https://tonviewer.com/transaction/" + "ab".repeat(32) };
    const html = renderToStaticMarkup(<HistoryRow item={paid} />);
    expect(html).toContain('href="https://tonviewer.com/transaction/');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(text(html)).toContain("перевод ↗");
    const sending = renderToStaticMarkup(<HistoryRow item={{ ...withdraw, status: "sending", status_label: "отправляется" }} />);
    expect(text(sending)).toContain("отправляется");
    expect(sending).not.toContain("tonviewer");
  });
});
