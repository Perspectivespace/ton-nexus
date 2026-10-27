import { describe, expect, it } from "vitest";
import { CONFIG, LIMITS, SPAN, drop, newGame, replay, sliderX, speedFor, top, type Booster, type Game } from "./engine";

/**
 * Общие векторы для движка на JS и его порта на Python (backend/app/services/tower_engine.py).
 * Файл shared/tower-vectors.json пишет ЭТОТ тест (npx vitest run -u), читают оба: этот и backend/tests/test_tower_engine.py.
 * Если правило игры меняется — меняются векторы, и тест на Python падает, пока порт не поправлен так же.
 */

const GAP = 120; // не раньше чем через столько мс после появления блока (человек так быстро не тапнет)

function timeAt(g: Game, from: number, want: (x: number) => boolean): number {
  for (let t = from; t < from + 30000; t++) if (want(sliderX(g, t))) return t;
  throw new Error("момент не найден");
}

type Step = number | "miss"; // отступ левого края от верха в ед. (0 — идеально) или промах

/** бот: играет по плану отступов, потом промахивается; возвращает журнал тапов и сам забег */
function play(seed: number, booster: Booster | null, plan: (i: number) => Step, blocks: number, endWithMiss = true, jitter = 0): number[] {
  let lcg = (seed * 2654435761 + 12345) >>> 0;
  const g = newGame(seed, booster);
  for (let i = 0; i < blocks && !g.over; i++) {
    const step = plan(i);
    const from = g.spawnT + GAP;
    let t: number;
    if (step === "miss") t = timeAt(g, from, (x) => x >= top(g).x + top(g).w || x + g.w <= top(g).x);
    else if (step === 0) t = timeAt(g, from, (x) => Math.abs(x - top(g).x) <= CONFIG.PERFECT_TOL);
    else t = timeAt(g, from, (x) => x - top(g).x >= step && x - top(g).x <= step + 8 && Math.abs(x - top(g).x) > CONFIG.PERFECT_TOL);
    if (jitter) {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      t += (lcg >>> 10) % (jitter + 1);
    }
    drop(g, t);
  }
  if (endWithMiss && !g.over) drop(g, timeAt(g, g.spawnT + GAP, (x) => x >= top(g).x + top(g).w || x + g.w <= top(g).x));
  return g.taps;
}

const mixed = (i: number): Step => [0, 0, 0, 60, 0, 0, 25, 0, 0, 0, 0, 120, 0, 40][i % 14];
const allPerfect = (): Step => 0;
const sloppy = (i: number): Step => (i % 3 === 0 ? 30 : i % 3 === 1 ? 90 : 160);

/** журнал «как у человека»: тапы через случайные 150–900 мс, не подгоняя под блок (LCG, без Math.random) */
function noisy(seed: number, n: number): number[] {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  const taps: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    t += 150 + (x >>> 8) % 751;
    taps.push(t);
  }
  return taps;
}

interface Case {
  name: string;
  seed: number;
  booster: Booster | null;
  taps: number[];
}

function cases(): Case[] {
  const out: Case[] = [];
  const add = (name: string, seed: number, booster: Booster | null, taps: number[]) => out.push({ name, seed, booster, taps });
  const seeds: [string, number][] = [["s1", 1], ["s42", 42], ["s0", 0], ["smax", 4294967295], ["s2026", 20261027], ["srnd", 2693262067]];
  for (const [n, seed] of seeds) {
    add(`${n}-perfect-30`, seed, null, play(seed, null, allPerfect, 30));
    add(`${n}-mixed-40`, seed, null, play(seed, null, mixed, 40));
    add(`${n}-sloppy-25`, seed, null, play(seed, null, sloppy, 25));
    add(`${n}-slow-perfect-30`, seed, "slow", play(seed, "slow", allPerfect, 30));
    add(`${n}-slow-mixed-40`, seed, "slow", play(seed, "slow", mixed, 40));
    add(`${n}-jitter-60`, seed, null, play(seed, null, allPerfect, 80, true, 60));
    add(`${n}-slow-jitter-60`, seed, "slow", play(seed, "slow", allPerfect, 80, true, 60));
    add(`${n}-noisy`, seed, null, noisy(seed, 60));
    add(`${n}-slow-noisy`, seed, "slow", noisy(seed, 60));
  }
  // «Прицел» не меняет ход игры: тот же журнал, тот же итог
  add("s42-aim-same-as-plain", 42, "aim", play(42, null, mixed, 40));
  // долгий забег: скорость доходит до потолка VMAX, ширина упирается в W0
  add("s7-perfect-120", 7, null, play(7, null, allPerfect, 120, false));
  add("s7-slow-perfect-120", 7, "slow", play(7, "slow", allPerfect, 120, false));
  // сразу промах первым тапом
  add("s9-first-miss", 9, null, play(9, null, () => "miss", 1));
  // граничные журналы: пустой, тапы после конца, время назад
  add("s3-empty", 3, null, []);
  const a = play(3, null, mixed, 12);
  add("s3-taps-after-over", 3, null, [...a, a[a.length - 1] + 500, a[a.length - 1] + 900]);
  add("s3-time-goes-back", 3, null, [...a.slice(0, 4), a[3] - 1, ...a.slice(4)]);
  return out;
}

describe("общие векторы JS ↔ Python", () => {
  it("shared/tower-vectors.json совпадает с движком (обновить: npx vitest run -u)", async () => {
    const list = cases().map((c) => ({ ...c, expected: replay(c.seed, c.taps, c.booster) }));
    await expect(JSON.stringify({ version: 1, config: { ...CONFIG, SPAN }, limits: LIMITS, cases: list }, null, 1) + "\n").toMatchFileSnapshot(
      "../../../../shared/tower-vectors.json",
    );
  });

  it("векторы охватывают разные исходы", () => {
    const list = cases().map((c) => replay(c.seed, c.taps, c.booster));
    expect(list.some((r) => r.over)).toBe(true);
    expect(list.some((r) => !r.over)).toBe(true);
    expect(list.some((r) => r.accepted < 1 + 0)).toBe(true); // пустой журнал
    expect(Math.max(...list.map((r) => r.score))).toBeGreaterThan(300);
    expect(Math.max(...list.map((r) => r.bestCombo))).toBeGreaterThan(20);
  });

  it("бустер «slow»: первые 10 блоков на 15 % медленнее, дальше как обычно; «aim» скорость не меняет", () => {
    for (let placed = 0; placed < 10; placed++) {
      const base = speedFor(placed);
      expect(speedFor(placed, "slow")).toBe(Math.floor((base * 85) / 100));
      expect(speedFor(placed, "slow")).toBeLessThan(base);
    }
    expect(speedFor(10, "slow")).toBe(speedFor(10));
    expect(speedFor(0, "slow")).toBe(408); // 480 * 0.85
    for (const p of [0, 4, 9, 10, 40, 120]) expect(speedFor(p, "aim")).toBe(speedFor(p));
  });

  it("бустер — часть входа: тот же журнал с «slow» и без него даёт разный забег", () => {
    const taps = play(42, null, mixed, 20);
    const plain = replay(42, taps, null);
    const slow = replay(42, taps, "slow");
    expect(replay(42, taps, "aim")).toEqual(plain);
    expect(slow).not.toEqual(plain);
  });
});
