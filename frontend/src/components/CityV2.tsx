import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useMe } from "@/api/hooks";
import { REACTOR_TIERS, reactorLevel, tierFor } from "@/lib/reactorTiers";

/**
 * Город растёт вместе с реактором (DESIGN.md п. 3.10–3.11). Облик города = облик реактора (п. 8.1.1):
 * T1 Mk I (ур. 1–4), T2 Mk II (5+), T3 Mk III (10+), T4 Mk IV (20+).
 * Один нарисованный кадр на облик (webp 720×1280, грузится лениво — только текущий облик)
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

// ночной и дневной («Дневной HUD») кадр на облик; дневной — тот же кадр, заранее осветлённый и в дымке
const loaders = import.meta.glob<string>("../assets/city/v2/city-t*.webp", { query: "?url", import: "default" });
const load = (t: number, day: boolean) => loaders[`../assets/city/v2/city-t${t}${day ? "-day" : ""}.webp`]?.();

/** светлая тема на <html data-theme> (меняется по событию Telegram themeChanged) */
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const isDay = () => document.documentElement.dataset.theme === "light";

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

  const day = useSyncExternalStore(subscribeTheme, isDay);

  useEffect(() => {
    let alive = true;
    load(tier, day)?.then((url) => {
      if (!alive) return;
      setSrc((old) => {
        setPrev(old); // смена облика: старый кадр растворяется под новым
        return url;
      });
    });
    return () => {
      alive = false;
    };
  }, [tier, day]);

  return (
    <div className={`cv2 t${tier}`}>
      {prev && prev !== src && <img className="cv2-img prev" src={prev} alt="" />}
      {src && <img key={src} className="cv2-img" src={src} alt="" decoding="async" />}
      <div className="cv2-life">
        {/* ── БАЗОВАЯ ЖИЗНЬ: на каждом облике, включая T1 (11 анимаций) ── */}
        <i className="fog f-far" />
        <i className="fog f-near" />
        <i className="rain" />
        {WIN.map(([x, y, d, dl], n) => (
          <i key={`w${n}`} className="win" style={{ ...box(x, y, 7, 8), "--d": `${d}s`, "--dl": `-${dl}s` } as Vars} />
        ))}
        {BEACONS.map(([x, y, dl], n) => (
          <i key={`b${n}`} className="bcn" style={{ left: pc(x, W), top: pc(y, H), "--dl": `-${dl}s` } as Vars} />
        ))}
        <i className="drone" style={{ top: pc(470, H) }} />
        <i className="steam" style={{ left: pc(598, W), top: pc(628, H) }} />
        <i className="steam s2" style={{ left: pc(612, W), top: pc(630, H) }} />

        {/* ── T1–T2: круги на лужах (город ещё спит, дождь слышнее) ── */}
        {tier <= 2 && <i className="ripple" style={{ left: pc(250, W), top: pc(1090, H) }} />}

        {/* ── T2+: вывески зажглись (одна иногда «моргает»), воздушная полоса ── */}
        {tier >= 2 && (
          <>
            <b className={`sign v ${tier >= 4 ? "holo" : "quiet cut"}`} style={box(72, 578, 40, 170)}>ОБМЕН</b>
            <b className={`sign ${tier >= 4 ? "holo" : "quiet"}`} style={box(444, 808, 44, 52)}>TON</b>
            <i className="craft c0" />
          </>
        )}
        {/* ── T3+: башня под током, ещё два борта ── */}
        {tier >= 3 && (
          <>
            <i className="conduit" style={box(379, 370, 24, 500)} />
            <i className="craft c1" />
            <i className="craft c2" />
          </>
        )}
        {/* ── T4: голо-«РЕАКТОР» с развёрткой, прожектор, третий борт ── */}
        {tier >= 4 && (
          <>
            <b className="sign holo wide scan" style={box(543, 705, 112, 86)}>
              РЕАКТОР<small>MK IV · ОНЛАЙН</small>
            </b>
            <i className="beam" style={{ left: pc(600, W), top: pc(1000, H) }} />
            <i className="craft c3" />
          </>
        )}
      </div>
    </div>
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
    <div className="cv2-window" aria-hidden="true">
      <span className="cv2-chip">
        <span className="ui-label">Район</span> {TIER_MOOD[t]} · «{REACTOR_TIERS[t - 1]?.name}»
      </span>
    </div>
  );
}
