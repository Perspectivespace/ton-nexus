import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Фоновый город «Ночного контура» + «искры жизни» (DESIGN.md п. 3.10–3.11).
 * Чисто декоративный слой: aria-hidden, без событий, не влияет на логику экранов.
 * Координаты точек — в пикселях исходного кадра 390×700 (из стайлборда v3).
 */
const W = 390;
const H = 700;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: pc(x, W),
  top: pc(y, H),
  width: pc(w, W),
  height: pc(h, H),
});

// окна, которые иногда гаснут (6 из 37 найденных на картинке)
const WINDOWS: [number, number][] = [
  [38.5, 446.5], [106.2, 463.9], [208.3, 411.7], [202, 224], [213, 320], [202, 448],
];
// вывески: моргает одна за раз (сдвинутые циклы 11/14/17 с)
const SIGNS: [number, number, number, number][] = [
  [48, 284, 26, 154], [181, 235, 42, 28], [269, 467, 64, 20],
];
// искры над рельсом и вывеской
const SPARKS: [number, number, string, number][] = [
  [96, 568, "#FFB547", 5], [222, 566, "#2BF5FF", -4], [300, 470, "#FFB547", 6],
  [150, 570, "#FFB547", -3], [332, 566, "#2BF5FF", 4],
];
// красные огни на крышах
const BEACONS: [number, number][] = [[273, 79], [126, 137]];

type Vars = CSSProperties & Record<`--${string}`, string>;

export function CityBackdrop() {
  const front = useRef<HTMLDivElement>(null);

  // параллакс ближнего плана при прокрутке: максимум 6 px
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = Math.min(6, window.scrollY * 0.02);
        front.current?.style.setProperty("--py", `${(-y).toFixed(1)}px`);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="city" aria-hidden="true">
      <div className="c-stage">
        <div className="c-front" ref={front} />
        <div className="life">
          {WINDOWS.map(([x, y], n) => (
            <i
              key={`w${n}`}
              className="w-off"
              style={{ ...box(x - 0.5, y - 0.5, 4, 4.8), "--d": `${9 + n * 2}s`, "--dl": `-${((n * 3.7) % 9).toFixed(1)}s` } as Vars}
            />
          ))}
          {SIGNS.map(([x, y, w, h], n) => (
            <i key={`s${n}`} className="s-cut" style={{ ...box(x, y, w, h), "--d": `${11 + n * 3}s`, "--dl": `-${n * 4}s` } as Vars} />
          ))}
          {SPARKS.map(([x, y, c, dx], n) => (
            <i
              key={`p${n}`}
              className="spark"
              style={{
                left: pc(x, W),
                top: pc(y, H),
                "--c": c,
                "--dx": `${dx}px`,
                "--d": `${3.4 + n * 0.7}s`,
                "--dl": `-${(1.1 + n * 0.9).toFixed(1)}s`,
              } as Vars}
            />
          ))}
          <i className="rain" />
          {BEACONS.map(([x, y], n) => (
            <i key={`b${n}`} className="bcn" style={{ left: pc(x, W), top: pc(y, H), "--dl": `-${n * 1.1 + 0.4}s` } as Vars} />
          ))}
          <i className="drone" />
        </div>
      </div>
      <div className="c-scrim" />
    </div>
  );
}
