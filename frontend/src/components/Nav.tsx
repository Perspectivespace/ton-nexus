import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useWheelStatus } from "@/api/hooks";
import { hasFreeSpin } from "@/lib/games";
import { IconCoins, IconGamepad, IconHome, IconReactor, IconUser } from "./icons";
import { Dock } from "./ui/index";

/**
 * Пять мест дока: Контур · Майнер · [Игры] · Заработок · Профиль.
 * До PR «б» Заработок ведёт на ленту заданий `/tasks`, Профиль — на баланс `/wallet`.
 */
export const dockItems = [
  { to: "/", label: "Контур", Icon: IconHome },
  { to: "/miner", label: "Майнер", Icon: IconReactor },
  { to: "/tasks", label: "Заработок", Icon: IconCoins },
  { to: "/wallet", label: "Профиль", Icon: IconUser },
] as const;

/** Док виден только на корневых экранах разделов (DESIGN п. 14.2) */
export function isDockRoute(path: string) {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return dockItems.some((i) => i.to === p);
}

/** шторка игр — отдельный чанк с framer-motion; тянется по касанию кнопки */
const loadSheet = () => import("./GamesSheet");
const GamesSheet = lazy(loadSheet);

/**
 * Нижний док и приподнятая неоновая кнопка «Игры» над средним слотом (DESIGN.md п. 14.2).
 * Янтарная точка — есть бесплатное вращение колеса (GET /wheel/status). Открытая шторка — кнопка «нажата».
 */
export function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const dot = hasFreeSpin(useWheelStatus().data);
  const close = useCallback(() => setOpen(false), []);

  // смена экрана (карточка игры, «Назад») закрывает шторку
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="dock-layer">
      <Dock
        items={dockItems}
        className={pathname === "/" ? undefined : "deep"}
        center={
          <span className={open ? "dock-mid on" : "dock-mid"} aria-hidden="true">
            <i />
            <span>Игры</span>
          </span>
        }
      />
      <button
        ref={btn}
        type="button"
        className={open ? "dock-games on" : "dock-games"}
        aria-label={dot ? "Игры — есть бесплатное вращение" : "Игры"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "games-sheet" : undefined}
        onPointerDown={() => void loadSheet()}
        onClick={() => {
          setArmed(true);
          setOpen((v) => !v);
        }}
      >
        <span className="orb">
          <IconGamepad size={26} />
          {dot && !open && <span className="dot" />}
        </span>
      </button>
      {armed && (
        <Suspense fallback={null}>
          <GamesSheet open={open} onClose={close} returnFocus={btn} />
        </Suspense>
      )}
    </div>
  );
}
