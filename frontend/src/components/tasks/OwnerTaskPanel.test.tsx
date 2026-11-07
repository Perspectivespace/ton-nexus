// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerTaskSummary } from "@/api/hooks";
import { OwnerTaskPanelView, actionLine, cancelConfirmText } from "./OwnerTaskPanel";

const task = {
  id: 7,
  title: "Подпишись на канал",
  description: "Скрин подписки",
  task_type: "manual_proof",
  target_url: null,
  reward: "0.10000000",
  total_slots: 10,
  filled_slots: 3,
  status: "active",
  min_level: 1,
  xp_reward: 10,
  creator_id: 2,
};
const S: OwnerTaskSummary = {
  task,
  pending: 2,
  paid_out: "0.3",
  creator_payout: "1",
  creator_commission: "0.1",
  platform_payout: "0",
  charged: "1.1",
  refundable: "0.55",
  commission_bp: 1000,
  log: [
    { id: 1, action: "add_slots", mode: "free", actor_id: 1, creator_delta: "0", platform_delta: "0.5", details: null, created_at: null },
    { id: 2, action: "cancel", mode: null, actor_id: 1, creator_delta: "-0.55", platform_delta: "0", details: null, created_at: null },
  ],
};
const noop = () => {};
const view = (s: OwnerTaskSummary) =>
  renderToStaticMarkup(<OwnerTaskPanelView summary={s} onCancel={noop} onAddSlots={noop} onPrice={noop} onEdit={noop} />);

describe("OwnerTaskPanel", () => {
  it("сводка, режимы по умолчанию — с баланса создателя / создатель доплачивает", () => {
    const html = view(S);
    expect(html).toContain("Управление");
    expect(html).toContain("Можно вернуть");
    expect(html).toContain("0.55");
    expect(html).toContain("С баланса создателя");
    expect(html).toContain("За счёт платформы");
    expect(html).toContain("Разницу берёт платформа");
    expect(html).toContain("Отменить задание");
    expect(html).not.toContain("Карточка услуги");
  });

  it("подтверждение отмены называет сумму возврата и заявки на проверке", () => {
    expect(cancelConfirmText(S)).toBe(
      "Создателю вернётся 0.55 TON за свободные места. Заявок на проверке: 2. Их можно будет одобрить или отклонить. Отмену нельзя откатить.",
    );
    const partner = { ...S, task: { ...task, task_type: "partner" } };
    expect(cancelConfirmText(partner)).toContain("Продажи закроются");
  });

  it("партнёрская услуга: форма карточки и «Закрыть продажи», без бюджета", () => {
    const html = view({ ...S, task: { ...task, task_type: "partner" } });
    expect(html).toContain("Карточка услуги");
    expect(html).toContain("Закрыть продажи");
    expect(html).not.toContain("Оплатил создатель");
    expect(html).not.toContain("За счёт платформы");
  });

  it("отменённое — без действий", () => {
    const html = view({ ...S, task: { ...task, status: "cancelled" } });
    expect(html).toContain("отменено");
    expect(html).not.toContain("Добавить");
  });

  it("строки журнала", () => {
    expect(actionLine(S.log[0])).toBe("Добавлены выполнения · платформа добавила 0.5 TON");
    expect(actionLine(S.log[1])).toBe("Отмена · возвращено создателю 0.55 TON");
  });
});
