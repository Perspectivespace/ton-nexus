import { useEffect, useId, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useDragControls, useReducedMotion, type Transition } from "framer-motion";
import { useTowerMe, useWheelStatus } from "@/api/hooks";
import { pushBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { prefetchRoute } from "@/lib/routes";
import { towerLine, wheelLine } from "@/lib/games";
import { SheetHeader } from "@/components/ui/SheetHeader";
import { IconChevron } from "@/components/icons";

/** Колесо: диск с секторами, спицами и восемью лампами (сетка 48) */
function WheelArt() {
  const lamps = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const r = (a * Math.PI) / 180;
    return [24 + 20.2 * Math.sin(r), 24 - 20.2 * Math.cos(r)] as const;
  });
  return (
    <svg className="gs-ico" width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M24 24L24 7A17 17 0 0 1 36.02 11.98Z" fill="currentColor" fillOpacity=".22" stroke="none" />
      <path d="M24 24L24 41A17 17 0 0 1 11.98 36.02Z" fill="currentColor" fillOpacity=".22" stroke="none" />
      <circle cx="24" cy="24" r="17" strokeWidth="2.2" />
      <circle cx="24" cy="24" r="12" strokeWidth="1" opacity=".5" />
      <path
        d="M24 19.5V7M24 28.5V41M19.5 24H7M28.5 24H41M20.82 20.82L11.98 11.98M27.18 27.18L36.02 36.02M27.18 20.82L36.02 11.98M20.82 27.18L11.98 36.02"
        strokeWidth="1.5"
      />
      <circle cx="24" cy="24" r="4.5" strokeWidth="2" />
      <circle cx="24" cy="24" r="1.6" fill="currentColor" stroke="none" />
      {lamps.map(([x, y], i) => (
        <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r="1.3" fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}

/** Башня: шпиль, три яруса и основание (сетка 48) */
function TowerArt() {
  return (
    <svg className="gs-ico" width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M24 6.4V10.5" strokeWidth="1.8" />
      <circle cx="24" cy="6.4" r="1.4" fill="currentColor" stroke="none" />
      <path d="M20 15L21.5 10.5H26.5L28 15Z" strokeWidth="1.8" fill="currentColor" fillOpacity=".22" />
      <rect x="18.5" y="15" width="11" height="11" strokeWidth="1.8" />
      <rect x="16" y="26" width="16" height="13" strokeWidth="1.8" />
      <path d="M13 39H35V43H13Z" strokeWidth="1.8" fill="currentColor" fillOpacity=".3" />
      <path d="M21.5 18.5H26.5M21.5 22.5H26.5M19.5 30H22.5M25.5 30H28.5M19.5 34.5H22.5M25.5 34.5H28.5" strokeWidth="1.4" opacity=".75" />
    </svg>
  );
}

const lowEnd = () => typeof document !== "undefined" && document.documentElement.classList.contains("low-end");

/**
 * Шторка «Игры» (DESIGN.md п. 14.2): две премиальные карточки — Колесо удачи и Башня; вся карточка — ссылка.
 * Отдельный чанк (framer-motion не в стартовой загрузке), монтируется при первом открытии.
 * Закрывается свайпом вниз (за ручку и шапку), крестиком, тапом по фону, Esc и «Назад» Telegram.
 * При открытии подтягиваются чанки Колеса и Башни. Бесконечных анимаций нет; «уменьшить движение» — мгновенно,
 * слабое устройство — короткое проявление без пружины.
 */
export default function GamesSheet({
  open,
  onClose,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const titleId = useId();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const wheel = useWheelStatus();
  const tower = useTowerMe();
  const w = wheelLine(wheel.data);
  const t = towerLine(tower.data?.best_month);

  useEffect(() => {
    if (!open) return;
    haptic.sheet();
    void prefetchRoute("/wheel");
    void prefetchRoute("/tower");
    const back = () => closeRef.current();
    const key = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", key);
    const pop = pushBack(back);
    const f = requestAnimationFrame(() => closeBtn.current?.focus({ preventScroll: true }));
    const ret = returnFocus?.current;
    return () => {
      cancelAnimationFrame(f);
      window.removeEventListener("keydown", key);
      pop();
      const a = document.activeElement;
      if (!a || a === document.body || sheet.current?.contains(a)) ret?.focus({ preventScroll: true });
    };
  }, [open, returnFocus]);

  const lite = lowEnd();
  const move: Transition = reduce ? { duration: 0 } : lite ? { duration: 0.16, ease: "easeOut" } : { type: "spring", duration: 0.32, bounce: 0.12 };
  const fade: Transition = reduce ? { duration: 0 } : { duration: lite ? 0.12 : 0.2, ease: "easeOut" };
  const from = reduce || lite ? { opacity: 0 } : { opacity: 0, y: 24 };
  // свайп — жест, а не анимация: работает и при «уменьшить движение», только без пружины
  const startDrag = (e: React.PointerEvent) => drag.start(e);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="dim" className="gs-dim" aria-hidden="true" onClick={() => closeRef.current()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} />
      )}
      {open && (
        <motion.div
          key="sheet"
          ref={sheet}
          id="games-sheet"
          className="gs-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={from}
          animate={{ opacity: 1, y: 0 }}
          exit={from}
          transition={move}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.7 }}
          dragMomentum={false}
          onDragEnd={(_, i) => {
            if (i.offset.y > 64 || i.velocity.y > 500) closeRef.current();
          }}
        >
          <div className="gs-grab-zone" onPointerDown={startDrag} aria-hidden="true">
            <i className="gs-grab" />
          </div>
          <div className="gs-head" onPointerDown={startDrag}>
            <SheetHeader title="Игры" sub="Выберите игру" id={titleId} onClose={() => closeRef.current()} closeRef={closeBtn} />
          </div>

          <Link to="/wheel" className="gs-card" onClick={() => haptic.tap()}>
            <span className="gs-art" aria-hidden="true">
              <span className="gs-med">
                <WheelArt />
              </span>
            </span>
            <span className="gs-body">
              <span className="gs-txt">
                <span className="gs-name">Колесо удачи</span>
                <span className={w.hot ? "gs-st hot" : "gs-st"}>
                  {w.hot && <i aria-hidden="true" />}
                  {w.text}
                </span>
              </span>
              <span className="gs-go" aria-hidden="true">
                Крутить
                <IconChevron size={14} />
              </span>
            </span>
          </Link>

          <Link to="/tower" className="gs-card amber" onClick={() => haptic.tap()}>
            <span className="gs-art" aria-hidden="true">
              <span className="gs-med">
                <TowerArt />
              </span>
            </span>
            <span className="gs-body">
              <span className="gs-txt">
                <span className="gs-name">Башня</span>
                <span className="gs-st">{t}</span>
              </span>
              <span className="gs-go" aria-hidden="true">
                Играть
                <IconChevron size={14} />
              </span>
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
