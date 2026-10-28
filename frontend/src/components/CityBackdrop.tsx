import { markBusy } from "@/lib/quiet";
import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { CityV2, useCityTier } from "./CityV2";
import { Interior, type InteriorAnim } from "./CityBuildings";
import { buildingAt, motionMode } from "@/lib/buildings";
import { syncChrome } from "@/lib/theme";

/**
 * Фоновый город под всем приложением (п. 3.10–3.11); внутри раздела-здания (сейчас только «Майнер») —
 * его интерьер вместо улицы. В раздел ведёт док: интерьер просто проявляется, улица под ним скрыта и стоит.
 */
export function CityBackdrop() {
  const tier = useCityTier();
  const loc = useLocation();
  const inside = buildingAt(loc.pathname);
  const [anim, setAnim] = useState<InteriorAnim>("still");
  const seen = useRef(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const first = !seen.current;
    seen.current = true;
    if (!first) markBusy(1000); // первая секунда нового экрана (не первой загрузки) — без фоновой подгрузки чанков
    if (inside) {
      setAnim(first || motionMode() === "none" ? "still" : "dock");
      root.classList.add("in-bld");
    } else {
      root.classList.remove("in-bld");
    }
    syncChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);

  return (
    <div className={`city${inside ? " inside" : ""}`}>
      <div className="c-stage" aria-hidden={inside ? "true" : undefined}>
        <div aria-hidden="true">
          <CityV2 tier={tier} />
        </div>
      </div>
      {inside && <Interior key={inside.id + anim} id={inside.id} anim={anim} />}
      <div className="c-scrim" aria-hidden="true" />
    </div>
  );
}
