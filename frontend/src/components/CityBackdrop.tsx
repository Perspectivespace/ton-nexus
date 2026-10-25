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
  [48, 284, 26, 154], [181, 235, 42, 28], [246, 464, 104, 23],
];
// искры над рельсом и вывеской «МАЙНИНГ»
const SPARKS: [number, number, string, number][] = [
  [96, 568, "#FFB547", 5], [222, 566, "#2BF5FF", -4], [300, 470, "#FFB547", 6],
  [150, 570, "#FFB547", -3], [332, 566, "#2BF5FF", 4],
];
// КОНЦЕПТ: окна центральной башни, загорающиеся волной снизу вверх
const CC_WIN: [number, number][] = [[192, 540], [210, 522], [198, 500], [216, 478], [188, 455], [205, 432], [193, 405], [212, 380]];
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
          {/* КОНЦЕПТ города (concept/miner-tiers): слои скрыты, пока на <html> нет класса cc-a / cc-b / cc-c */}
          <i className="cc cc-a fly f1" />
          <i className="cc cc-a fly f2" />
          <i className="cc cc-a fly f3" />
          <i className="cc cc-b stream" style={box(186, 232, 30, 330)} />
          <i className="cc cc-b halo" style={{ left: pc(201, W), top: pc(186, H) }} />
          {CC_WIN.map(([x, y], n) => (
            <i key={`cw${n}`} className="cc cc-b wwave" style={{ ...box(x, y, 4, 4.6), "--dl": `${(n * 0.32).toFixed(2)}s` } as Vars} />
          ))}
          <i className="cc cc-c fog g1" />
          <i className="cc cc-c fog g2" />
          <i className="cc cc-c beam b1" style={{ left: pc(330, W), top: pc(470, H) }} />
          <i className="cc cc-c beam b2" style={{ left: pc(70, W), top: pc(300, H) }} />
        </div>
      </div>
      <div className="c-scrim" />
    </div>
  );
}
