import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { PayoutWalletBar } from "./PayoutWalletBar";

const EXPECTED = "UQ" + "E".repeat(46);
const EXPECTED_RAW = "0:" + "ee".repeat(32);
const OTHER = "UQ" + "F".repeat(46);
const OTHER_RAW = "0:" + "ff".repeat(32);
const noop = () => {};

const bar = (p: { restored?: boolean; address?: string | null; friendly?: string | null }) =>
  renderToStaticMarkup(
    <PayoutWalletBar
      restored={p.restored ?? true}
      address={p.address ?? null}
      friendly={p.friendly ?? null}
      expected={EXPECTED}
      expectedRaw={EXPECTED_RAW}
      onConnect={noop}
      onDisconnect={noop}
    />,
  ).replace(/<[^>]+>/g, " ");

describe("Касса: блок «Кошелёк выплат»", () => {
  it("пока сессия восстанавливается — «Загрузка…»", () => {
    expect(bar({ restored: false })).toContain("Загрузка…");
  });

  it("не подключён — кнопка подключения и пояснение, что Профиль не меняется", () => {
    const t = bar({});
    expect(t).toContain("не подключён");
    expect(t).toContain("Подключить кошелёк выплат");
    expect(t).toContain("кошелёк в Профиле оно не меняет");
  });

  it("подключён кошелёк выплат — адрес и «Отключить»", () => {
    const t = bar({ address: EXPECTED_RAW, friendly: EXPECTED });
    expect(t).toContain("подключён");
    expect(t).not.toContain("не подключён");
    expect(t).not.toContain("подключён другой");
    expect(t).toContain("Отключить");
    expect(t).toContain(EXPECTED.slice(0, 4));
  });

  it("подключён другой — подсказка без упоминания личного кошелька", () => {
    const t = bar({ address: OTHER_RAW, friendly: OTHER });
    expect(t).toContain("подключён другой");
    expect(t).toContain("Это не кошелёк выплат");
    expect(t).toContain("Отключить");
    expect(t.toLowerCase()).not.toMatch(/личн/);
  });
});
