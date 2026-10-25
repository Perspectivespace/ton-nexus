import { useEffect, useState, type CSSProperties } from "react";

/**
 * КОНЦЕПТ «Город растёт с реактором» (ветка concept/city-tiers, не для мержа).
 * Один нарисованный кадр на облик (webp 720×1280, грузится лениво — только текущий облик)
 * + тонкий слой движения поверх: туман на двух глубинах, транспорт, энергия по башне,
 * голографические вывески, луч, блики на мокром асфальте. Только transform / opacity.
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

const loaders = import.meta.glob<string>("../assets/city/v2/city-t*.webp", { query: "?url", import: "default" });
const load = (t: number) => loaders[`../assets/city/v2/city-t${t}.webp`]?.();

export function readCityTier(): number {
  try {
    const q = new URLSearchParams(location.search).get("city");
    const v = Number(q ?? localStorage.getItem("cityv2") ?? 0);
    return v >= 1 && v <= 4 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

export function CityV2({ tier }: { tier: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load(tier)?.then((url) => {
      if (!alive) return;
      setSrc((old) => {
        setPrev(old); // смена облика: старый кадр растворяется под новым
        return url;
      });
    });
    return () => {
      alive = false;
    };
  }, [tier]);

  return (
    <div className={`cv2 t${tier}`}>
      {prev && prev !== src && <img className="cv2-img prev" src={prev} alt="" />}
      {src && <img key={src} className="cv2-img" src={src} alt="" decoding="async" />}
      <div className="cv2-life">
        {/* туман на двух глубинах — всегда */}
        <i className="fog f-far" />
        <i className="fog f-near" />
        {/* T2+: машина по улице */}
        {tier >= 2 && <i className="car" style={{ top: pc(1018, H) }} />}
        {/* T2: вывески только зажглись — тихий текст */}
        {tier === 2 && (
          <>
            <b className="sign v quiet" style={box(72, 578, 40, 170)}>ОБМЕН</b>
            <b className="sign quiet" style={box(444, 808, 44, 52)}>TON</b>
          </>
        )}
        {/* T3+: башня под током — энергия бежит по каналу, борта в небе */}
        {tier >= 3 && (
          <>
            <i className="conduit" style={box(379, 370, 24, 500)} />
            <i className="craft c1" />
            <i className="craft c2" />
          </>
        )}
        {/* T4: голо-вывески, луч, третий борт, блики на асфальте */}
        {tier >= 4 && (
          <>
            <b className="sign v holo" style={box(72, 578, 40, 170)}>ОБМЕН</b>
            <b className="sign holo" style={box(444, 808, 44, 52)}>TON</b>
            <b className="sign holo wide" style={box(543, 705, 112, 86)}>
              РЕАКТОР<small>MK IV · ОНЛАЙН</small>
            </b>
            <i className="beam" style={{ left: pc(600, W), top: pc(1000, H) }} />
            <i className="craft c3" />
            <i className="sheen" style={box(0, 1030, 720, 250)} />
          </>
        )}
      </div>
    </div>
  );
}

const TIER_RU = ["", "Прототип", "Контур", "Марк", "Сингулярность"];
const TIER_MOOD = ["", "город спит", "город просыпается", "башня под током", "город в огнях"];

/** КОНЦЕПТ: «окно в город» на главной. Пустая полоса ~240 px, город сдвигается так, чтобы в окне была башня и вывески. */
export function CityWindow() {
  const t = readCityTier();
  useEffect(() => {
    if (!t) return;
    document.documentElement.classList.add("cv2-home");
    return () => document.documentElement.classList.remove("cv2-home");
  }, [t]);
  if (!t) return null;
  return (
    <div className="cv2-window" aria-hidden="true">
      <span className="cv2-chip">
        <span className="ui-label">Район</span> {TIER_MOOD[t]} · «{TIER_RU[t]}»
      </span>
    </div>
  );
}
