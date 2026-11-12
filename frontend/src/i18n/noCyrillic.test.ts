import { describe, expect, it } from "vitest";
import { cyrillicLines, stripComments } from "./scan";

/**
 * Каждая строка, которую видит игрок, — из словаря (src/i18n/ru, src/i18n/en). Кириллица прямо в коде
 * разрешена только в комментариях, в самих словарях и в инструментах команды, которые остаются на русском.
 */
/* файлы читаем с диска: @types/node в проекте нет (как в styles/animBudget.test.ts) */
type Fs = {
  readFileSync(path: URL, enc: "utf8"): string;
  readdirSync(path: URL, opts: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
};
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const SRC = new URL("../", import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, SRC), "utf8");

/** Кабинет владельца и инструменты команды — на русском (решение владельца) */
const STAFF = [
  "pages/Owner.tsx",
  "pages/Deploy.tsx",
  "pages/Roles.tsx",
  "pages/WithdrawQueue.tsx",
  "pages/Kit.tsx", // витрина компонентов, только dev-сборка
  "components/owner/",
  "components/DeployPanel.tsx",
  "components/DepositsAdmin.tsx",
  "components/RolesPanel.tsx",
  "components/SettingEditor.tsx",
  "components/TowerPrizesAdmin.tsx",
  "components/tasks/OwnerTaskPanel.tsx",
  "lib/settingsMeta.ts",
  "lib/fpsMeter.ts", // диагностическая плашка FPS для команды
  "components/WorkArea.tsx", // «Управление» в Профиле — только команде
  "components/WithdrawCard.tsx", // Касса
  "components/PayoutButton.tsx",
  "components/PayoutSession.tsx",
  "components/PayoutWalletBar.tsx",
  "lib/payoutFlow.ts",
];

/** Не для игрока: образец шрифта с кириллицей и ошибки для разработчика (в консоль, не на экран) */
const INTERNAL = ["lib/fontWarm.ts", "lib/payoutStorage.ts", "lib/payoutSession.ts", "lib/districtAssets.ts"];

/** Ещё не переведено — список только сокращается (следующие PR серии i18n) */
const TODO: string[] = [
  "components/AdCard.tsx",
  "components/CityAdSpots.tsx",
  "components/CityV2.tsx",
  "components/CityWalk.tsx",
  "components/DistrictIdleAds.tsx",
  "components/DistrictNav.tsx",
  "components/IdleSpot.tsx",
  "components/SecretSignal.tsx",
  "components/cityads/AdCalendar.tsx",
  "components/cityads/AdCardPreview.tsx",
  "components/cityads/AdScene.tsx",
  "components/cityads/BuyFlow.tsx",
  "components/cityads/FacadeImage.tsx",
  "components/cityads/MyAds.tsx",
  "lib/buildings.ts",
  "lib/cityAdBuy.ts",
  "lib/districtIdle.ts",
  "lib/districts.ts",
  "lib/facadeImage.ts",
  "pages/CityAds.tsx",
  "pages/District.tsx",
];

const ALLOWED = (f: string) => f.startsWith("i18n/") || INTERNAL.includes(f) || STAFF.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));

/** Пути от src/: "pages/Home.tsx" */
function files(dir = ""): string[] {
  return fs.readdirSync(new URL(dir, SRC), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return files(`${dir}${e.name}/`);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [dir + e.name] : [];
  });
}

describe("кириллица в коде для игроков", () => {
  const all = files();

  it("разбор: комментарии вырезаются, строки остаются", () => {
    const src = 'const a = "ok"; // коммент\n/* блок\nещё */ const b = `да`;\n{/* jsx */}<b>текст</b>';
    expect(cyrillicLines(src).map(([n]) => n)).toEqual([3, 4]);
    expect(stripComments('const u = "http://x"; // да')).toContain("http://x");
  });

  it("нет кириллицы вне словарей и кабинета команды", () => {
    const bad: string[] = [];
    for (const f of all) {
      if (ALLOWED(f) || TODO.includes(f)) continue;
      const src = read(f);
      for (const [n, l] of cyrillicLines(src)) bad.push(`${f}:${n}: ${l.slice(0, 120)}`);
      // числа и даты — через fmtNum / fmtDate (язык игрока), не прибитым русским форматом
      if (/["']ru-RU["']/.test(stripComments(src))) bad.push(`${f}: "ru-RU" — нужен fmtNum / fmtDate из @/i18n`);
    }
    expect(bad).toEqual([]);
  });

  it("список «ещё не переведено» не врёт: в нём только файлы, где кириллица правда есть", () => {
    const stale = TODO.filter((f) => !all.includes(f) || cyrillicLines(read(f)).length === 0);
    expect(stale).toEqual([]);
  });
});
