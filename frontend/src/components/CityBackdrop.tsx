import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { CityV2, useCityTier } from "./CityV2";
import { CityHotspots, Interior, setZoomVars, type InteriorAnim } from "./CityBuildings";
import { BUILDINGS, FADE_MS, ZOOM_MS, buildingAt, motionMode, type BuildingId } from "@/lib/buildings";

/** Состояние «вошли через здание» лежит в history.state маршрута */
export const viaBuilding = (state: unknown, id?: string) => !!id && (state as { bld?: string } | null)?.bld === id;

/**
 * Фоновый город под всем приложением + концепт «интерактивные здания» (п. 3.8.3):
 * на главной — точки входа, внутри раздела-здания — его интерьер вместо улицы.
 */
export function CityBackdrop() {
  const tier = useCityTier();
  const loc = useLocation();
  const navType = useNavigationType();
  const inside = buildingAt(loc.pathname);
  const via = viaBuilding(loc.state, inside?.id);
  const [leaving, setLeaving] = useState<{ id: BuildingId; anim: InteriorAnim } | null>(null);
  const [enterAnim, setEnterAnim] = useState<InteriorAnim>("still");
  const prev = useRef<{ id?: BuildingId; via: boolean } | null>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const p = prev.current;
    prev.current = { id: inside?.id, via };
    root.classList.remove("bz-hide");
    const timers: number[] = [];
    if (inside) {
      setLeaving(null);
      const mode = motionMode();
      // через здание — интерьер «надвигается» навстречу наезду; через док — просто проявляется
      setEnterAnim(!p ? "still" : mode === "none" ? "still" : via ? mode : "dock");
      root.classList.add("in-bld");
      // интерьер закрыл улицу — камеру можно вернуть на место (под интерьером, без перехода)
      timers.push(window.setTimeout(() => root.classList.remove("bz-in", "bz-fade"), 400));
    } else {
      root.classList.remove("in-bld", "bz-in", "bz-fade");
      const mode = motionMode();
      if (p?.id && p.via && navType === "POP" && mode !== "none") {
        // «Назад» из здания: интерьер уходит, камера отъезжает от здания на улицу
        setLeaving({ id: p.id, anim: mode === "zoom" ? "out" : "out-fade" });
        root.classList.add("bz-back");
        if (mode === "zoom") {
          setZoomVars(BUILDINGS[p.id], tier);
          root.classList.add("bz-in", "bz-snap");
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              root.classList.remove("bz-snap", "bz-in");
            }),
          );
        }
        timers.push(
          window.setTimeout(() => {
            setLeaving(null);
            root.classList.remove("bz-back");
          }, mode === "zoom" ? ZOOM_MS + 30 : FADE_MS + 80),
        );
      } else {
        setLeaving(null);
        root.classList.remove("bz-back");
      }
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);

  const shown = inside ? { id: inside.id, anim: enterAnim } : leaving;
  return (
    <div className={`city${inside && !leaving ? " inside" : ""}`}>
      <div className="c-stage" aria-hidden={inside ? "true" : undefined}>
        <div className="c-zoom">
          <div aria-hidden="true">
            <CityV2 tier={tier} />
          </div>
          {loc.pathname === "/" && <CityHotspots tier={tier} />}
        </div>
      </div>
      {shown && <Interior key={shown.id + shown.anim} id={shown.id} anim={shown.anim} />}
      <div className="c-scrim" aria-hidden="true" />
    </div>
  );
}
