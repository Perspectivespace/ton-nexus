import { forwardRef, useImperativeHandle, useRef } from "react";
import { DISTRICT_ORDER, DISTRICT_RU, type DistrictId } from "@/lib/districts";
import { neighbourOf } from "@/lib/districtNav";
import type { EdgeState } from "@/lib/districtCamera";
import { haptic } from "@/lib/haptics";

/**
 * Навигация между районами в «Прогулке» (PR 3 районов): полоска «Центр · Неон-ряды · Порт» внизу экрана
 * и подсказки соседа у краёв улицы. Оба района — финальный рисунок, поэтому районы открыты всем игрокам
 * (раньше — только владельцу). Покупка мест в районах выключена до PR 6 (места не продаются).
 */
export const DISTRICTS_OPEN = true;
export function useDistrictsOpen(): boolean {
  return DISTRICTS_OPEN;
}

export function DistrictStrip({ current, onGo }: { current: DistrictId; onGo: (to: DistrictId) => void }) {
  return (
    <nav className="dz-strip" aria-label="Районы города">
      {DISTRICT_ORDER.map((d) => (
        <button
          key={d}
          type="button"
          className={d === current ? "on" : undefined}
          aria-current={d === current ? "page" : undefined}
          onClick={() => {
            if (d === current) return;
            haptic.tap();
            onGo(d);
          }}
        >
          {DISTRICT_RU[d]}
        </button>
      ))}
    </nav>
  );
}

export type EdgeHintsHandle = { update: (s: EdgeState) => void };

/**
 * Подсказки соседних районов у краёв: проявляются, когда камера у края улицы, растут при протяжке за край;
 * дотянули — «Отпустите». Обновляются напрямую из кадра камеры (без перерисовки React).
 */
export const EdgeHints = forwardRef<EdgeHintsHandle, { current: DistrictId }>(function EdgeHints({ current }, ref) {
  const l = useRef<HTMLDivElement>(null);
  const r = useRef<HTMLDivElement>(null);
  const left = neighbourOf(current, -1);
  const right = neighbourOf(current, 1);
  useImperativeHandle(ref, () => ({
    update: (s) => {
      for (const [el, side, near] of [
        [l.current, -1, s.l],
        [r.current, 1, s.r],
      ] as const) {
        if (!el) continue;
        const p = s.dir === side ? s.p : 0;
        el.style.setProperty("--pull", p.toFixed(3));
        el.classList.toggle("near", near || p > 0);
        el.classList.toggle("ready", p >= 1);
      }
    },
  }));
  return (
    <>
      {left && (
        <div ref={l} className="dz-edge l" aria-hidden="true">
          <i>‹</i>
          <span>
            <b>{DISTRICT_RU[left]}</b>
            <em>Отпустите</em>
          </span>
        </div>
      )}
      {right && (
        <div ref={r} className="dz-edge r" aria-hidden="true">
          <span>
            <b>{DISTRICT_RU[right]}</b>
            <em>Отпустите</em>
          </span>
          <i>›</i>
        </div>
      )}
    </>
  );
});
