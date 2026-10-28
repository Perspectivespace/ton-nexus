import { useEffect, useRef } from "react";
import type { CityPhase } from "@/lib/cityPhase";
import { blocked, rnd } from "./CityDaySky";
import { still } from "./CityDusk";

/**
 * Поезд-маглев (DESIGN.md п. 12.1) — вместо прежнего «часа пика» на эстакадах. Вечером и ночью изредка
 * (раз в 25–50 с) обтекаемый состав с горящими окнами, мягкой фарой и лёгким светящимся следом
 * пересекает просвет между левым кварталом и башней на средней глубине и уходит за башню (слой .cv2-back
 * под вырезанной копией башни; слева его закрывает обрезка по краю квартала). Почти невидимый рельс.
 * Каждый проход — разовая WAAPI-анимация на 5–8 с, следующий запускает таймер; бесконечных анимаций нет.
 * Скрытое приложение — новые проходы не стартуют. Слабое устройство и «уменьшить движение» — поезда нет.
 * `?train=now` — для проверки: первый проход через 0,8 с, дальше каждые 9 с.
 */

const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
/** просвет: от правого края левого квартала до правого края башни (дальше поезд за башней) */
const X0: Record<number, number> = { 1: 180, 2: 180, 3: 180, 4: 178 };
const X1 = 520;
const Y = 806; // верх состава в кадре 720×1280
const TL = 104; // длина состава
const TH = 6.5; // высота состава

const testing = () => new URLSearchParams(location.search).get("train") === "now";

export function CityTrain({ tier, phase }: { tier: number; phase: CityPhase }) {
  const train = useRef<HTMLDivElement>(null);
  const x0 = X0[tier] ?? X0[1];
  const off = still();

  useEffect(() => {
    if (off) return;
    const now = testing();
    let t = 0;
    let run: Animation | null = null;
    const plan = (ms: number) => {
      t = window.setTimeout(tick, ms);
    };
    const tick = () => {
      const el = train.current;
      if (!el || still()) return;
      if (blocked()) return plan(4000); // приложение скрыто — не стартуем, проверяем позже
      const ltr = Math.random() < 0.5;
      el.classList.toggle("rtl", !ltr);
      const span = ((X1 - x0 + TL) / TL) * 100; // путь в процентах длины состава
      const [a, b] = ltr ? [0, span] : [span, 0];
      run = el.animate(
        [
          { transform: `translate3d(${a}%,0,0)`, opacity: 1 },
          { transform: `translate3d(${b}%,0,0)`, opacity: 1 },
        ],
        { duration: rnd(5000, 8000), easing: "linear" },
      );
      run.onfinish = () => {
        run = null;
        plan(now ? 9000 : rnd(25000, 50000));
      };
    };
    plan(now ? 800 : rnd(6000, 15000));
    return () => {
      window.clearTimeout(t);
      run?.cancel();
    };
  }, [off, x0]);

  if (off) return null;
  return (
    <div className={`trn-wrap ${phase}`} aria-hidden style={{ clipPath: `inset(0 ${pc(W - X1, W)} 0 ${pc(x0, W)})` }}>
      <i className="trn-rail" style={{ left: pc(x0, W), width: pc(X1 - x0, W), top: pc(Y + TH + 1.5, H) }} />
      <div ref={train} className="trn" style={{ left: pc(x0 - TL, W), top: pc(Y, H), width: pc(TL, W), height: pc(TH, H) }}>
        <div className="tb">
          <i className="trail" />
          <i className="lev" />
          <i className="body" />
          <i className="wins" />
          <i className="hl" />
        </div>
      </div>
    </div>
  );
}
