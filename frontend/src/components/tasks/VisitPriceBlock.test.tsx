// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VisitPriceBlock } from "./VisitPriceBlock";

const Q = {
  reward: "0.01",
  payout: "1",
  commission: "0.1",
  total: "1.1",
  commission_bp: 1000,
  slots: 100,
};

describe("VisitPriceBlock", () => {
  it("показывает исполнитель / комиссия / к оплате из quote", () => {
    const html = renderToStaticMarkup(<VisitPriceBlock quote={Q} />);
    expect(html).toContain("Исполнитель получит");
    expect(html).toContain("0.01");
    expect(html).toContain("Комиссия");
    expect(html).toContain("0.1");
    expect(html).toContain("К оплате");
    expect(html).toContain("1.1");
    expect(html).toContain("10%");
  });

  it("в загрузке без quote — плейсхолдеры", () => {
    const html = renderToStaticMarkup(<VisitPriceBlock quote={null} loading />);
    expect(html).toContain("…");
    expect(html).toContain("Исполнитель получит");
  });
});
