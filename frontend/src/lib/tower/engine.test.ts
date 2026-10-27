import { describe, expect, it } from "vitest";
import { CONFIG, SPAN, drop, newGame, replay, sliderX, speedFor, top, type Game } from "./engine";

/** первый момент не раньше from, когда левый край скользящего блока отличается от верха не больше чем на dx */
function timeAt(g: Game, from: number, want: (x: number) => boolean): number {
  for (let t = from; t < from + 20000; t++) if (want(sliderX(g, t))) return t;
  throw new Error("момент не найден");
}
const perfectT = (g: Game, from: number) => timeAt(g, from, (x) => Math.abs(x - top(g).x) <= CONFIG.PERFECT_TOL);
/** тап, при котором блок сильно съехал вправо от верха, но ещё перекрывается */
const offsetT = (g: Game, from: number, off: number) => timeAt(g, from, (x) => x - top(g).x >= off && x - top(g).x <= off + 8);

describe("tower engine", () => {
  it("mulberry32: фиксированные значения (на них опирается порт на сервере)", () => {
    // фаза первого блока при seed=1 — первый вывод mulberry32 по модулю 2*SPAN
    const g = newGame(1);
    expect(g.rng).toBe((1 + 0x6d2b79f5) >>> 0);
    expect(g.phase).toBe(2693262067 % (SPAN * 2)); // 2693262067 — эталонный mulberry32(1)
    expect(g.phase).toBe(947);
  });

  it("одинаковый seed и тапы — одинаковый результат; другой seed — другой ход блока", () => {
    const a = newGame(12345);
    const b = newGame(12345);
    const c = newGame(12346);
    expect(a.phase).toBe(b.phase);
    expect(a.phase).not.toBe(c.phase);
    for (const t of [0, 1, 777, 5000]) expect(sliderX(a, t)).toBe(sliderX(b, t));
  });

  it("скользящий блок остаётся в ходе и ходит туда-обратно", () => {
    const g = newGame(7);
    const lo = CONFIG.FIELD / 2 - CONFIG.RANGE - (g.w >> 1);
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 8000; t++) {
      const x = sliderX(g, t);
      min = Math.min(min, x);
      max = Math.max(max, x);
      expect(Number.isInteger(x)).toBe(true);
    }
    expect(min).toBeGreaterThanOrEqual(lo);
    expect(max).toBeLessThanOrEqual(lo + SPAN);
    expect(max - min).toBeGreaterThan(SPAN - 40); // за 8 с ход пройден весь
  });

  it("скорость растёт с блоками и упирается в потолок", () => {
    expect(speedFor(0)).toBe(CONFIG.V0);
    expect(speedFor(10)).toBe(CONFIG.V0 + 10 * CONFIG.DV);
    expect(speedFor(10_000)).toBe(CONFIG.VMAX);
  });

  it("идеальный бросок: блок встаёт ровно на верх, ничего не режется, очки 2", () => {
    const g = newGame(99);
    const t = perfectT(g, 300);
    const r = drop(g, t)!;
    expect(r.kind).toBe("perfect");
    expect(r.cut).toBeNull();
    expect(r.placed).toEqual({ x: 320, w: CONFIG.W0 });
    expect(r.points).toBe(2);
    expect(g.score).toBe(2);
    expect(g.blocks).toHaveLength(2);
  });

  it("обычный бросок режет свес, остаток = перекрытие, очко 1, серия сбрасывается", () => {
    const g = newGame(99);
    const r1 = drop(g, perfectT(g, 300))!;
    expect(r1.combo).toBe(1);
    const t = offsetT(g, r1.t + 200, 100);
    const r = drop(g, t)!;
    expect(r.kind).toBe("cut");
    const base = g.blocks[1];
    expect(r.placed!.x).toBe(r.drop.x);
    expect(r.placed!.w).toBe(base.x + base.w - r.drop.x);
    expect(r.cut!.x).toBe(base.x + base.w);
    expect(r.cut!.w).toBe(r.drop.w - r.placed!.w);
    expect(r.placed!.w + r.cut!.w).toBe(r.drop.w);
    expect(r.points).toBe(1);
    expect(g.combo).toBe(0);
    expect(g.score).toBe(3);
  });

  it("свес слева режется слева", () => {
    const g = newGame(5);
    const t = timeAt(g, 100, (x) => top(g).x - x >= 90 && top(g).x - x <= 98);
    const r = drop(g, t)!;
    expect(r.kind).toBe("cut");
    expect(r.cut!.x).toBe(r.drop.x);
    expect(r.placed!.x).toBe(g.blocks[0].x);
  });

  it("серия идеальных: очки 2,3,4,5,6,6…; с 3-го блок расширяется, но не шире начального", () => {
    const g = newGame(2024);
    let t = 200;
    const pts: number[] = [];
    const widths: number[] = [];
    for (let i = 0; i < 8; i++) {
      t = perfectT(g, t + 150);
      const r = drop(g, t)!;
      expect(r.kind).toBe("perfect");
      pts.push(r.points);
      widths.push(r.placed!.w);
    }
    expect(pts).toEqual([2, 3, 4, 5, 6, 6, 6, 6]);
    expect(widths.slice(0, 2)).toEqual([360, 360]);
    expect(Math.max(...widths)).toBeLessThanOrEqual(CONFIG.W0);
    expect(g.bestCombo).toBe(8);
    expect(g.perfects).toBe(8);
  });

  it("расширение: суженный блок растёт на REGROW за идеальный с 3-го подряд", () => {
    const g = newGame(31);
    // два обычных броска сужают башню
    let t = 200;
    for (let i = 0; i < 2; i++) {
      t = offsetT(g, t + 150, 60);
      expect(drop(g, t)!.kind).toBe("cut");
    }
    const w0 = top(g).w;
    expect(w0).toBeLessThan(CONFIG.W0);
    const ws: number[] = [];
    for (let i = 0; i < 4; i++) {
      t = perfectT(g, t + 150);
      expect(drop(g, t)!.kind).toBe("perfect");
      ws.push(top(g).w);
    }
    expect(ws).toEqual([w0, w0, w0 + CONFIG.REGROW, w0 + 2 * CONFIG.REGROW]);
  });

  it("промах мимо башни — конец забега, дальше тапы не принимаются", () => {
    const g = newGame(3);
    const t = timeAt(g, 0, (x) => x - top(g).x >= CONFIG.W0 + 20);
    const r = drop(g, t)!;
    expect(r.kind).toBe("miss");
    expect(r.placed).toBeNull();
    expect(g.over).toBe(true);
    expect(g.score).toBe(0);
    expect(drop(g, t + 500)).toBeNull();
    expect(g.taps).toHaveLength(1);
  });

  it("тап раньше появления блока и нечисловое время не принимаются", () => {
    const g = newGame(3);
    drop(g, perfectT(g, 500));
    const before = g.taps.length;
    expect(drop(g, g.spawnT - 1)).toBeNull();
    expect(drop(g, NaN)).toBeNull();
    expect(g.taps).toHaveLength(before);
  });

  it("replay по журналу даёт тот же счёт, что и живой забег; хвост после конца отбрасывается", () => {
    const g = newGame(555);
    let t = 100;
    // забег: идеальные вперемешку с обычными, в конце — промах
    const plan = ["p", "p", "c", "p", "c", "c", "p", "p", "p", "m"];
    for (const k of plan) {
      t += 150;
      if (k === "p") t = perfectT(g, t);
      else if (k === "c") t = offsetT(g, t, 50);
      else t = timeAt(g, t, (x) => Math.abs(x - top(g).x) > top(g).w + 10 && (x + g.w <= top(g).x || x >= top(g).x + top(g).w));
      expect(drop(g, t)).not.toBeNull();
    }
    expect(g.over).toBe(true);
    const r = replay(555, [...g.taps, g.taps[g.taps.length - 1] + 400]);
    expect(r).toEqual({ score: g.score, height: g.blocks.length - 1, perfects: g.perfects, bestCombo: g.bestCombo, over: true, accepted: g.taps.length });
    // другой seed с тем же журналом — другой результат (журнал привязан к seed)
    expect(replay(556, g.taps).score).not.toBe(g.score);
  });

  it("журнал не зависит от того, сколько раз мы читали положение блока (чистые функции)", () => {
    const a = newGame(8);
    const b = newGame(8);
    for (let t = 0; t < 3000; t += 7) sliderX(a, t);
    const ta = perfectT(a, 400);
    expect(ta).toBe(perfectT(b, 400));
    expect(drop(a, ta)).toEqual(drop(b, ta));
  });
});
