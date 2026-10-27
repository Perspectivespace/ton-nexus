import { markBusy } from "@/lib/quiet";
import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { CityV2, useCityTier } from "./CityV2";
import { Interior, msToArrive, setZoomVars, type InteriorAnim } from "./CityBuildings";
import { entryMark } from "@/lib/entryTrace";
import { BUILDINGS, FADE_MS, ZOOM_MS, buildingAt, motionMode, type BuildingId } from "@/lib/buildings";

/** Состояние «вошли через здание» лежит в history.state маршрута */
export const viaBuilding = (state: unknown, id?: string) => !!id && (state as { bld?: string } | null)?.bld === id;

/**
 * Фоновый город под всем приложением + интерактивные здания (п. 3.8.3):
 * внутри раздела-здания (сейчас только «Майнер») — его интерьер вместо улицы. Точка входа — в «окне в город» (CityWindow).
 */
export function CityBackdrop() {
  const tier = useCityTier();
  const loc = useLocation();
  const navType = useNavigationType();
  const inside = buildingAt(loc.pathname);
  const via = viaBuilding(loc.state, inside?.id);
  const [leaving, setLeaving] = useState<{ id: BuildingId; anim: InteriorAnim } | null>(null);
  const [enter, setEnter] = useState<{ anim: InteriorAnim; delay: number }>({ anim: "still", delay: 0 });
  const prev = useRef<{ id?: BuildingId; via: boolean } | null>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const p = prev.current;
    prev.current = { id: inside?.id, via };
    const timers: number[] = [];
    if (p) markBusy(1000); // первая секунда нового экрана (не первой загрузки) — без фоновой подгрузки чанков
    if (inside) {
      setLeaving(null);
      const mode = motionMode();
      // через здание — экран раздела уже смонтирован под невидимым контентом, камера ещё едет:
      // интерьер «надвигается» и контент проявляется ровно к концу наезда; через док — просто проявляется
      // хвост наезда (кривая замедляется) перекрываем: интерьер стартует за 150 мс до конца, контент — за 80 мс
      const left = via && p ? msToArrive() : 0;
      const delay = Math.max(0, left - 80);
      setEnter({ anim: !p ? "still" : mode === "none" ? "still" : via ? mode : "dock", delay: Math.max(0, left - 150) });
      root.classList.add("in-bld");
      if (via) {
        entryMark("в здании");
        requestAnimationFrame(() => requestAnimationFrame(() => entryMark("отрисован")));
      }
      const arrive = () => {
        // контент уже отрисован под opacity 0 на своём слое — к концу наезда меняется только opacity
        root.classList.replace("bz-hide", "bz-show");
        timers.push(window.setTimeout(() => root.classList.remove("bz-show"), 400));
      };
      if (delay > 0) timers.push(window.setTimeout(arrive, delay));
      else root.classList.remove("bz-hide");
      // интерьер закрыл улицу — камеру можно вернуть на место (под интерьером, без перехода)
      timers.push(window.setTimeout(() => root.classList.remove("bz-in", "bz-fade"), delay + 400));
    } else {
      root.classList.remove("bz-hide", "bz-show", "in-bld", "bz-in", "bz-fade");
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

  const shown = inside ? { id: inside.id, ...enter } : leaving && { ...leaving, delay: 0 };
  return (
    <div className={`city${inside && !leaving ? " inside" : ""}`}>
      <div className="c-stage" aria-hidden={inside ? "true" : undefined}>
        <div className="c-zoom">
          <div aria-hidden="true">
            <CityV2 tier={tier} />
          </div>
        </div>
      </div>
      {shown && <Interior key={shown.id + shown.anim} id={shown.id} anim={shown.anim} delay={shown.delay} />}
      <div className="c-scrim" aria-hidden="true" />
    </div>
  );
}
