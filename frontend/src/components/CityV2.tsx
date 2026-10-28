import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMe } from "@/api/hooks";
import { CityLightning } from "./CityLightning";
import { CityNeon } from "./CityNeon";
import { CityRain } from "./CityRain";
import { REACTOR_TIERS, reactorLevel, tierFor } from "@/lib/reactorTiers";
import { useCityPhase, type CityPhase } from "@/lib/cityPhase";
import { TOWER_SILHOUETTE } from "@/lib/towerSilhouette";

/**
 * Город растёт вместе с реактором (DESIGN.md п. 3.10–3.11). Облик города = облик реактора (п. 8.1.1):
 * T1 Mk I (ур. 1–4), T2 Mk II (5+), T3 Mk III (10+), T4 Mk IV (20+).
 * Один нарисованный кадр на облик × фазу суток по МСК (webp 720×1280, грузится лениво — только текущий; п. 3.8.2)
 * + слой движения поверх: базовая жизнь на каждом облике, облики добавляют слои. Только transform / opacity.
 * Координаты — в пикселях кадра 720×1280.
 */
const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: pc(x, W),
  top: pc(y, H),
  width: pc(w, W),
  height: pc(h, H),
});

// кадр на облик × фазу суток (п. 3.8.2): ночь city-tN, рассвет -dawn, день -day, вечер -dusk.
// Грузится только текущий; следующий подкачивается за полторы минуты до смены фазы.
const loaders = import.meta.glob<string>("../assets/city/v2/city-t*.webp", { query: "?url", import: "default" });
const SUFFIX: Record<CityPhase, string> = { night: "", dawn: "-dawn", day: "-day", dusk: "-dusk" };
const load = (t: number, p: CityPhase) => loaders[`../assets/city/v2/city-t${t}${SUFFIX[p]}.webp`]?.();
/** заранее скачать кадр (в кэш браузера), не показывая */
const preload = (t: number, p: CityPhase) =>
  load(t, p)?.then((url) => {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  });

type Vars = CSSProperties & Record<`--${string}`, string>;

// окна, которые зажигаются и гаснут: x, y, период, сдвиг (все в «окне в город» на главной)
const WIN: [number, number, number, number][] = [
  [118, 520, 4.6, 0.7],
  [338, 610, 5.8, 3.1],
  [470, 742, 6.9, 1.9],
];
// красные огни на шпилях: x, y, сдвиг
const BEACONS: [number, number, number][] = [
  [55, 412, 0.4],
  [650, 548, 1.5],
];

const TIER_KEY = "city:tier";
const clampTier = (v: number) => (v >= 1 && v <= 4 ? Math.floor(v) : 0);

/** последний известный облик: город рисуется сразу, не дожидаясь /me */
function cachedTier(): number {
  try {
    if (import.meta.env.DEV) {
      const q = clampTier(Number(new URLSearchParams(location.search).get("city")));
      if (q) return q; // ?city=1..4 — просмотр обликов в dev-сборке
    }
    return clampTier(Number(localStorage.getItem(TIER_KEY))) || 1;
  } catch {
    return 1;
  }
}

/** облик города по реальному уровню реактора (сумма характеристик − 4) */
export function useCityTier(): number {
  const { data: me } = useMe();
  const m = me?.miner;
  const real = m ? tierFor(reactorLevel(m)).id + 1 : 0;
  const tier = real || cachedTier();
  useEffect(() => {
    if (!real) return;
    try {
      localStorage.setItem(TIER_KEY, String(real));
    } catch {
      /* приватный режим */
    }
  }, [real]);
  return tier;
}

export function CityV2({ tier }: { tier: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);

  const { phase, upcoming } = useCityPhase();
  const occ = TOWER_SILHOUETTE[tier] ?? TOWER_SILHOUETTE[1];
  // за полторы минуты до смены фазы кадр следующей фазы (для текущего облика) уходит в кэш браузера
  useEffect(() => {
    if (upcoming) preload(tier, upcoming);
  }, [tier, upcoming]);
  const lastPhase = useRef(phase);
  const [slow, setSlow] = useState(false); // смена фазы растворяется дольше (2.4 с), чем смена облика

  // фаза на <html data-city-phase> — по ней панели светлой темы уплотняются над тёмной сценой (п. 3.8.2)
  useEffect(() => {
    document.documentElement.dataset.cityPhase = phase;
  }, [phase]);

  useEffect(() => {
    let alive = true;
    const phaseChanged = lastPhase.current !== phase;
    lastPhase.current = phase;
    load(tier, phase)?.then((url) => {
      if (!alive) return;
      setSlow(phaseChanged);
      setSrc((old) => {
        setPrev(old); // смена облика или фазы суток: старый кадр растворяется под новым
        return url;
      });
    });
    return () => {
      alive = false;
    };
  }, [tier, phase]);

  return (
    <div className={`cv2 t${tier} ph-${phase}`}>
      {prev && prev !== src && <img className="cv2-img prev" src={prev} alt="" />}
      {src && <img key={src} className={`cv2-img${slow ? " slow" : ""}`} src={src} alt="" decoding="async" />}
      {/* ── ГЛУБИНА: задние борта летят за башней (п. 12.1). Над ними — копия кадра, вырезанная по силуэту
          башни: она закрывает борта, пока те за башней. Копия повторяет смену кадра (те же классы). ── */}
      <div className="cv2-back">
        <i className="drone flip" />
        {tier >= 3 && (
          <>
            <i className="craft c1" />
            <i className="craft c2 flip" />
          </>
        )}
        {tier >= 4 && <i className="craft c3 flip" />}
      </div>
      {/* ── СВЕТ (рассвет/день, daycity шаг 2): лучи солнца и тёплая кромка — за копией башни, она их режет.
          Статичные градиенты; одна медленная анимация лучей; ночью и вечером слой погашен. ── */}
      <div className="cv2-sun" aria-hidden>
        <i className="rays" />
        <i className="rim" style={{ clipPath: occ }} />
      </div>
      {prev && prev !== src && <img className="cv2-img prev cv2-occ" src={prev} alt="" style={{ clipPath: occ }} />}
      {src && <img key={`o${src}`} className={`cv2-img cv2-occ${slow ? " slow" : ""}`} src={src} alt="" decoding="async" style={{ clipPath: occ }} />}
      <div className="cv2-tone" aria-hidden>
        <i className="face" style={{ clipPath: occ }} />
        <i className="grade" />
      </div>
      <div className="cv2-life">
        {/* ── БАЗОВАЯ ЖИЗНЬ: на каждом облике, включая T1 (10 анимаций + дрон в заднем слое) ── */}
        <i className="fog f-far" />
        <i className="fog f-near" />
        <CityNeon phase={phase} tier={tier} />
        <CityRain phase={phase} tier={tier} />
        {WIN.map(([x, y, d, dl], n) => (
          <i key={`w${n}`} className="win" style={{ ...box(x, y, 7, 8), "--d": `${d}s`, "--dl": `-${dl}s` } as Vars} />
        ))}
        {BEACONS.map(([x, y, dl], n) => (
          <i key={`b${n}`} className="bcn" style={{ left: pc(x, W), top: pc(y, H), "--dl": `-${dl}s` } as Vars} />
        ))}
        <i className="steam" style={{ left: pc(598, W), top: pc(628, H) }} />
        <i className="steam s2" style={{ left: pc(612, W), top: pc(630, H) }} />

        {/* ── T2+: вывески зажглись (одна иногда «моргает»); единственный борт ПЕРЕД башней ── */}
        {tier >= 2 && (
          <>
            <b className={`sign v ${tier >= 4 ? "holo" : "quiet cut"}`} style={box(72, 578, 40, 170)}>ОБМЕН</b>
            <b className={`sign ${tier >= 4 ? "holo" : "quiet"}`} style={box(444, 808, 44, 52)}>TON</b>
            <i className="craft c0 front" />
          </>
        )}
        {/* ── T3+: башня под током (ещё два борта — в заднем слое .cv2-back) ── */}
        {tier >= 3 && (
          <>
            <i className="conduit" style={box(379, 370, 24, 500)} />
          </>
        )}
        {/* ── T4: голо-«РЕАКТОР» с развёрткой, прожектор (третий борт — в заднем слое) ── */}
        {tier >= 4 && (
          <>
            <b className="sign holo wide scan" style={box(543, 705, 112, 86)}>
              РЕАКТОР<small>MK IV · ОНЛАЙН</small>
            </b>
            <i className="beam" style={{ left: pc(600, W), top: pc(1000, H) }} />
          </>
        )}
        {/* ── экран раздела «Майнер» на реакторной башне (на всех обликах, статичный) ── */}
        <TowerScreen />
      </div>
      {/* ── редкая молния ночью: разовая вспышка раз в 25–60 с (п. 12.1) ── */}
      {phase === "night" && <CityLightning />}
    </div>
  );
}

/**
 * Экран «МАЙНЕР» на реакторной башне (п. 3.8.3) — живёт в слое города, в координатах кадра, как вывески:
 * сцена фиксирована под страницей, поэтому экран всегда стоит на башне, при любой прокрутке и ширине.
 * Чистый декор: башня не кнопка (в «Майнер» ведёт док), экран касаний не ловит и на них не отзывается.
 * band — тонкая светодиодная полоса поперёк фасада; blade — узкая вертикальная панель справа от шахты.
 */
type TwScreen = "band" | "blade";
const TW_SCREEN = "band" as TwScreen;
const TW_BOX: Record<TwScreen, [number, number, number, number]> = {
  band: [342, 576, 146, 20],
  blade: [426, 520, 22, 136],
};

function TowerScreen() {
  const [x, y, w, h] = TW_BOX[TW_SCREEN];
  return (
    <b className={`tw-scr ${TW_SCREEN}`} style={box(x, y, w, h)}>
      <i className="tw-led" />
      <span>МАЙНЕР</span>
    </b>
  );
}

const TIER_MOOD = ["", "город спит", "город просыпается", "башня под током", "город в огнях"];

/** «Окно в город» на главной: пустая полоса ~240 px, город сдвигается так, чтобы в окне была башня и вывески. */
export function CityWindow() {
  const t = useCityTier();
  useEffect(() => {
    document.documentElement.classList.add("cv2-home");
    return () => document.documentElement.classList.remove("cv2-home");
  }, []);
  return (
    <div className="cv2-window">
      <span className="cv2-chip" aria-hidden="true">
        <span className="ui-label">Район</span> {TIER_MOOD[t]} · «{REACTOR_TIERS[t - 1]?.name}»
      </span>
    </div>
  );
}
