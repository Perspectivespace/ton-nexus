import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { idleWhenQuiet } from "@/lib/quiet";
import { prefetchLikely } from "@/lib/routes";
import { Link } from "react-router-dom";
import { useDailyStatus, useMe, useMiner } from "@/api/hooks";
import { setServerClock } from "@/lib/cityPhase";
import { haptic } from "@/lib/haptics";
import { CityWindow } from "@/components/CityV2";
import { IconChevron, IconReactor, IconUp } from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Panel,
  Scrim,
  Num,
  Bar,
  Chip,
} from "@/components/ui";

const MINER_RU: Record<string, string> = {
  idle: "остановлен — запустите цикл",
  running: "цикл активен",
  ready: "хранилище полное — соберите",
};

/** раскрытие панели баланса — отдельный чанк с framer-motion (см. HomePanelMore) */
const loadMore = () => import("@/components/HomePanelMore");
const HomePanelMore = lazy(loadMore);

/** Панель баланса свёрнута по умолчанию — город не закрыт; выбор пользователя помним (DESIGN.md п. 3.8) */
const PANEL_KEY = "tn-home-panel";
function readOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === "open";
  } catch {
    return false;
  }
}
function usePanelOpen() {
  const [open, setOpen] = useState(readOpen);
  // чанк раскрытия смонтирован заранее, чтобы первое касание уже анимировалось (а не «щёлкало» без пружины)
  const [armed, setArmed] = useState(open);
  useEffect(() => {
    if (armed) return;
    let live = true;
    const arm = () => loadMore().then(() => live && setArmed(true), () => undefined);
    if (document.readyState === "complete") idleWhenQuiet(arm);
    else window.addEventListener("load", () => idleWhenQuiet(arm), { once: true });
    return () => {
      live = false;
    };
  }, [armed]);
  const toggle = useCallback(() => {
    setArmed(true);
    setOpen((v) => {
      try {
        localStorage.setItem(PANEL_KEY, v ? "closed" : "open");
      } catch {
        /* приватный режим */
      }
      return !v;
    });
  }, []);
  return { open, armed, toggle };
}

/**
 * Появление главной — CSS вместо framer-motion (главная в стартовом чанке, библиотека анимаций туда не входит).
 * Повторяет прежний рисунок: контейнер проявляется за 0,3 с; блоки, что есть при первом кадре, — по очереди
 * (0,1 с + 0,08 с на каждый), поднимаясь на 16 px за 0,45 с; блоки, пришедшие позже с данными, — сразу.
 */
type Rise = "head" | "hero";
const rise = (order: Rise[], k: Rise): { className: string; style?: CSSProperties } => {
  const i = order.indexOf(k);
  return { className: "home-rise", style: i >= 0 ? ({ "--rise-d": `${100 + i * 80}ms` } as CSSProperties) : undefined };
};

export function Home() {
  const { data: me, isLoading, error, isFetching } = useMe();
  const { data: miner } = useMiner();
  // часы сервера поправляют смену суток в городе (раньше это делала кнопка отметки — она теперь в «Заработке»)
  const daily = useDailyStatus();
  useEffect(() => setServerClock(daily.data?.server_time), [daily.data?.server_time]);
  // порядок блоков первого кадра — фиксируется один раз, как стаггер у framer-motion
  const first = useRef<Rise[] | null>(null);
  first.current ??= (["head", me && "hero"] as const).filter(Boolean) as Rise[];
  const r = (k: Rise) => rise(first.current!, k);
  // главная показана — в простое подтягиваем разделы, куда обычно идут дальше
  useEffect(() => prefetchLikely(), []);
  const panel = usePanelOpen();

  // развёрнутая часть панели: прогресс уровня, жетоны и статусы, реактор
  const details = me && (
    <div className="px-5 pb-5">
        <div className="pt-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="ui-label ui-shade">Прогресс уровня</span>
            <span className="ui-sys ui-shade">{me.xp % 100} / 100 XP</span>
          </div>
          <Bar value={(me.xp % 100) / 100} label="Прогресс уровня" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip label="Фокус" value={me.focus_tokens} />
          <Chip label="Запрет" value={me.block_tokens} />
          {me.success_boost_bp > 0 && (
            <span title="Бонус с колеса: прибавится к шансу следующей попытки усиления и потратится на ней">
              <StatusPill tone="ok">
                +{Number((me.success_boost_bp / 100).toFixed(1))}% к успеху · след. усиление
              </StatusPill>
            </span>
          )}
          {me.is_owner && <StatusPill tone="live">владелец</StatusPill>}
          {me.is_admin && !me.is_owner && <StatusPill tone="neutral">админ</StatusPill>}
          {me.is_ambassador && !me.is_admin && !me.is_owner && <StatusPill tone="neutral">амбассадор</StatusPill>}
          {me.can_deploy && <StatusPill tone="neutral">деплойер</StatusPill>}
        </div>

        {miner && (() => {
          const cap = Number(miner.storage_cap ?? 0);
          const acc = Number(miner.accrued_now ?? miner.pending_reward ?? 0);
          const pct = cap > 0 ? Math.min(100, Math.round((acc / cap) * 100)) : 0;
          const ready = miner.status === "ready";
          return (
            <Scrim className="relative -mx-5 -mb-5 mt-5 px-5 pb-4 pt-3">
              <Link to="/miner" className="home-rx no-underline" onClick={() => haptic.tap()}>
                <IconReactor size={20} />
                <span className="min-w-0 flex-1">
                  <span className="ui-label block">Реактор</span>
                  <span className="ui-sec block truncate !text-[13px]">{MINER_RU[miner.status] || miner.status}</span>
                </span>
                <span className={ready ? "ui-num tone-amber text-[15px] font-bold" : "ui-num text-[15px] font-bold"}>{pct}%</span>
                <IconChevron size={18} />
              </Link>
            </Scrim>
          );
        })()}
    </div>
  );

  return (
    <div className="home-in space-y-5">
      <div {...r("head")}>
        <ScreenHeader
          eyebrow="TON Nexus"
          title={me?.first_name || me?.username || "Контур"}
          action={
            me ? (
              <StatusPill tone={isFetching ? "live" : "ok"}>
                {isFetching ? "синхр." : "в сети"}
              </StatusPill>
            ) : undefined
          }
        />
      </div>

      {/* «окно в город»: полоса, где город не закрыт панелями (DESIGN.md п. 3.8) */}
      <CityWindow />

      {isLoading && <LoadingPanel label="Синхронизация контура…" />}
      {error && (
        <ErrorPanel message="Нет связи с сервером. Откройте приложение из Telegram." />
      )}

      {me && (
        <section {...r("hero")}>
          <Panel level="hero" see cut="l" lift="l2" className="home-panel">
            {/* свёрнутая полоса — баланс и уровень; она же ручка: касание раскрывает и сворачивает панель */}
            <button
              type="button"
              className="home-bar"
              aria-expanded={panel.open}
              aria-controls="home-more"
              aria-label={panel.open ? "Свернуть панель баланса" : "Развернуть панель баланса"}
              onPointerDown={() => void loadMore()}
              onClick={() => {
                haptic.tap();
                panel.toggle();
              }}
            >
              <i className="home-grab" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">
                <span className="ui-label ui-shade block">Баланс</span>
                <Num value={Number(me.balance).toFixed(4)} unit="TON" size="l" glow className="ui-shade block !text-[26px] !leading-[30px]" />
              </span>
              <span className="home-lv">
                <span className="flex items-center justify-end gap-1 text-[var(--text-3)]">
                  <IconUp size={11} />
                  <span className="ui-label">Ур.</span>
                  <Num value={me.level} size="m" className="!font-bold" />
                </span>
                <span className="ui-sys block text-right">{me.xp} XP</span>
              </span>
              <IconChevron size={18} className="home-chev" />
              {/* тонкая линия прогресса уровня — только в свёрнутом виде */}
              {!panel.open && <i className="home-xp" aria-hidden="true" style={{ "--xp": `${me.xp % 100}%` } as CSSProperties} />}
            </button>
            {panel.armed ? (
              <Suspense fallback={panel.open ? <div id="home-more">{details}</div> : null}>
                <HomePanelMore open={panel.open} id="home-more">
                  {details}
                </HomePanelMore>
              </Suspense>
            ) : (
              panel.open && <div id="home-more">{details}</div>
            )}
          </Panel>
        </section>
      )}
    </div>
  );
}
