import { useEffect, useState } from "react";
import markLit from "@/assets/brand/mark.svg";
import markUnlit from "@/assets/brand/mark-unlit.svg";
import markLight from "@/assets/brand/mark-light.svg";
import wordDark from "@/assets/brand/wordmark.svg";
import wordLight from "@/assets/brand/wordmark-light.svg";
import { haptic } from "@/lib/haptics";

const KEY = "tn-splash";
const IGNITION_MS = 900;
const FADE_MS = 240;

/** Заставку показываем один раз за запуск приложения (sessionStorage живёт до закрытия мини-приложения). */
export function shouldShowSplash() {
  try {
    return sessionStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * Заставка «зажигание знака» (docs/DESIGN.md, п. 10, лист 11), весь цикл 0,9 с: 120–380 мс неон вспыхивает ступеньками,
 * 380 мс разливается свет, 600 мс по металлу проходит блик, к 900 мс поднимается надпись; затем 240 мс растворение.
 * Прогресс-трубку со стайлборда не ставим: настоящего прогресса загрузки у нас нет, а фальшивый — обман.
 * Только opacity/transform. «Уменьшить движение» — сразу финальный кадр без мерцания и блика.
 * Тап по заставке — пропустить.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* приватный режим — просто покажем ещё раз в следующий запуск */
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const lit = window.setTimeout(() => haptic.impact("light"), reduced ? 0 : 380);
    const out = window.setTimeout(() => setLeaving(true), reduced ? 500 : IGNITION_MS);
    const end = window.setTimeout(onDone, (reduced ? 500 : IGNITION_MS) + FADE_MS);
    return () => [lit, out, end].forEach(window.clearTimeout);
  }, [onDone]);

  return (
    <div className={`splash${leaving ? " is-leaving" : ""}`} onClick={() => setLeaving(true)} onTransitionEnd={(e) => e.target === e.currentTarget && leaving && onDone()} aria-hidden>
      <div className="splash-spill" />
      <div className="splash-mark">
        <img className="b-dark sp-unlit" src={markUnlit} alt="" draggable={false} />
        <img className="b-dark sp-lit" src={markLit} alt="" draggable={false} />
        <img className="b-light sp-lit" src={markLight} alt="" draggable={false} />
        <span className="sp-sweep" />
      </div>
      <div className="splash-wm">
        <img className="b-dark" src={wordDark} alt="" draggable={false} />
        <img className="b-light" src={wordLight} alt="" draggable={false} />
        <span className="splash-tag">Сеть TON · майнинг и задания</span>
      </div>
    </div>
  );
}
