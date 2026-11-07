// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskTypeSelect, allowedTaskTypes } from "./TaskTypeSelect";
import { VisitPriceBlock } from "./VisitPriceBlock";

const noop = () => {};

describe("TaskTypeSelect", () => {
  it("«Кампания» видна только владельцу", () => {
    expect(allowedTaskTypes({ is_owner: true })).toContain("campaign");
    for (const me of [{ is_admin: true }, { is_ambassador: true }, {}, null]) {
      expect(allowedTaskTypes(me)).not.toContain("campaign");
      const html = renderToStaticMarkup(<TaskTypeSelect me={me} value="visit" onChange={noop} />);
      expect(html).not.toContain("Кампания");
      expect(html).toContain("Переход на сторонний ресурс");
    }
    const owner = renderToStaticMarkup(<TaskTypeSelect me={{ is_owner: true }} value="campaign" onChange={noop} />);
    expect(owner).toContain('value="campaign"');
    expect(owner).toContain("Кампания");
  });

  it("старые типы (manual_proof, link) больше нельзя выбрать никому", () => {
    expect(allowedTaskTypes({})).toEqual(["visit"]);
    expect(allowedTaskTypes({ is_admin: true })).toEqual(["visit"]);
    expect(allowedTaskTypes({ is_ambassador: true })).toEqual(["visit"]);
    expect(allowedTaskTypes({ is_owner: true })).toEqual(["visit", "campaign", "partner"]);
    const html = renderToStaticMarkup(<TaskTypeSelect me={{ is_owner: true }} value="visit" onChange={noop} />);
    expect(html).not.toContain("manual_proof");
    expect(html).not.toContain('value="link"');
  });

  it("блок цены показывает ручную награду кампании и override комиссии", () => {
    const html = renderToStaticMarkup(
      <VisitPriceBlock
        quote={{ reward: "0.25", payout: "10", commission: "0.5", total: "10.5", commission_bp: 500, slots: 40 }}
      />,
    );
    expect(html).toContain("0.25");
    expect(html).toContain("×40 = 10");
    expect(html).toContain("5%");
    expect(html).toContain("10.5");
  });
});
