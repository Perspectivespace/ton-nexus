// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PartnerBuyPanel, buyBlockReason, type PartnerBuyState } from "./PartnerBuyPanel";
import { PartnerPriceBlock } from "./PartnerPriceBlock";
import { TaskTypeSelect, allowedTaskTypes } from "./TaskTypeSelect";

const base: PartnerBuyState = {
  status: "active",
  price: "1.5",
  slotsLeft: 3,
  minLevel: 1,
  myLevel: 2,
  myBalance: "5",
  isPartner: false,
  purchased: false,
  pending: false,
  error: null,
};
const noop = () => {};

describe("PartnerBuyPanel", () => {
  it("кнопка «Купить за … TON» активна, когда всё ок", () => {
    const html = renderToStaticMarkup(<PartnerBuyPanel state={base} onBuy={noop} />);
    expect(html).toContain("Купить за 1.5 TON");
    expect(html).not.toContain("disabled");
  });

  it("не хватает баланса — понятная причина и кнопка выключена", () => {
    const s = { ...base, myBalance: "0.2" };
    expect(buyBlockReason(s)).toBe("Не хватает TON: нужно 1.5, на балансе 0.2.");
    const html = renderToStaticMarkup(<PartnerBuyPanel state={s} onBuy={noop} />);
    expect(html).toContain("disabled");
  });

  it("пока идёт оплата — кнопка выключена (двойной клик)", () => {
    const html = renderToStaticMarkup(<PartnerBuyPanel state={{ ...base, pending: true }} onBuy={noop} />);
    expect(html).toContain("Оплата…");
    expect(html).toContain("disabled");
  });

  it("куплено — без кнопки; свою услугу и закрытую купить нельзя", () => {
    const html = renderToStaticMarkup(<PartnerBuyPanel state={{ ...base, purchased: true }} onBuy={noop} />);
    expect(html).toContain("куплено");
    expect(html).not.toContain("Купить за");
    expect(buyBlockReason({ ...base, isPartner: true })).toContain("ваша услуга");
    expect(buyBlockReason({ ...base, status: "closed" })).toContain("закрыты");
    expect(buyBlockReason({ ...base, slotsLeft: 0 })).toContain("закончились");
  });
});

describe("Партнёрская услуга в форме", () => {
  it("тип виден только владельцу", () => {
    expect(allowedTaskTypes({ is_owner: true })).toContain("partner");
    for (const me of [{ is_admin: true }, { is_ambassador: true }, {}]) {
      expect(allowedTaskTypes(me)).not.toContain("partner");
      expect(renderToStaticMarkup(<TaskTypeSelect me={me} value="visit" onChange={noop} />)).not.toContain(
        "Партнёрская услуга",
      );
    }
  });

  it("разбивка цены: покупатель / партнёр / комиссия", () => {
    const html = renderToStaticMarkup(
      <PartnerPriceBlock quote={{ total: "1", payout: "0.9", commission: "0.1", commission_bp: 1000 }} />,
    );
    expect(html).toContain("Покупатель платит");
    expect(html).toContain("0.9");
    expect(html).toContain("10% платформе");
  });
});
