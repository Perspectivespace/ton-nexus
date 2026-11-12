import type { CSSProperties } from "react";
import { useCitySignal } from "@/api/hooks";
import { useCityWalk } from "@/lib/cityWalk";
import { motionAllowed } from "@/lib/walkPrefs";
import "@/styles/secret-signal.css";

/**
 * Секретный промокод «Прогулки» (пасхалка, без анонсов): маленькая голо-табличка с кодом в своей точке сцены —
 * не на месте рекламы и не под кнопками. Код приходит с сервера только пока идёт появление в этой локации;
 * расписания клиент не знает. Табличка не кликается (касания уходят городу), без бесконечных анимаций:
 * разовое проявление, на слабых устройствах и при «меньше движения» — сразу статично.
 */
export type SignalPlace = "centre" | "rows" | "port";

// коробка в долях рисунка: Центр — кадр 720×1280 (справа от башни, между строкой на башне и уличным неоном);
// районы — доли рисунка улицы (свободное небо / площадь рядом с местами рекламы, в кадре точки покоя камеры)
export const SIGNAL_BOX: Record<SignalPlace, [number, number, number, number]> = {
  centre: [425 / 720, 688 / 1280, 150 / 720, 54 / 1280],
  rows: [0.405, 0.29, 0.12, 0.055],
  port: [0.385, 0.36, 0.12, 0.055],
};

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export function SecretSignal({ place, active, still }: { place: SignalPlace; active: boolean; still: boolean }) {
  const { data } = useCitySignal(place, active);
  const code = active ? data?.code : null;
  if (!code) return null;
  const [x, y, w, h] = SIGNAL_BOX[place];
  // кегль под длину кода: моно-знак с разрядкой ≈ 0.68 em, поле ≈ 86% ширины
  const fit = Math.min(17, 86 / (0.68 * Math.max(code.length, 4)));
  const style = { left: pct(x), top: pct(y), width: pct(w), height: pct(h), ["--ss-fit" as string]: `${fit.toFixed(2)}cqw` } as CSSProperties;
  return (
    <div className={`ss-holo${still ? " still" : ""}`} style={style} role="img" aria-label={`Сигнал: ${code}`} data-place={place}>
      <span className="ss-k" aria-hidden="true">
        сигнал
      </span>
      <b className="ss-c" aria-hidden="true">
        {code}
      </b>
    </div>
  );
}

/** Центр: только в «Прогулке» (на главной код не показывается и не запрашивается) */
export function CentreSignal() {
  const walk = useCityWalk();
  return <SecretSignal place="centre" active={walk.active} still={!motionAllowed()} />;
}
