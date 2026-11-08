// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingEditor } from "./SettingEditor";

const noop = async () => {};

describe("SettingEditor: вложенные объекты", () => {
  it("поля второго уровня (места рекламы) заполнены значениями", () => {
    const html = renderToStaticMarkup(
      <SettingEditor
        settingKey="city_ads"
        formId="f"
        onSave={noop}
        value={{
          min_level: 3,
          spots: { tower_line: { price_day: "1.25", enabled: false } },
          limits: { banner: { title_max: 14, subtitle_max: 18 } },
        }}
      />,
    );
    expect(html).toContain('value="1.25"');
    expect(html).toContain('value="14"');
    expect(html).toContain('value="18"');
    expect(html).toMatch(/<option value="0" selected="">Выкл<\/option>/);
    expect(html).toContain("Неделя показа");
    expect(html).toContain("строка 8.75 TON");
  });
});
