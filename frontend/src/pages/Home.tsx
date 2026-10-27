import { useEffect, useRef, type CSSProperties } from "react";
import { prefetchLikely } from "@/lib/routes";
import { prefetchInterior } from "@/components/CityBuildings";
import { Link } from "react-router-dom";
import { useMe, useMiner } from "@/api/hooks";
import { useDaily } from "@/lib/useDaily";
import { haptic } from "@/lib/haptics";
import { reactorLevel } from "@/lib/reactorTiers";
import { WorkArea } from "@/components/WorkArea";
import { CityWindow } from "@/components/CityV2";
import {
  IconBolt,
  IconCheck,
  IconChevron,
  IconReactor,
  IconTower,
  IconUp,
  IconWheel,
} from "@/components/icons";
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
  List,
  ListRow,
  Button,
  SectionLabel,
} from "@/components/ui";

/** Нижний док уже ведёт на Майнер, Задания и Баланс — здесь только то, чего в доке нет */
const more = [
  { to: "/wheel", title: "Колесо удачи", sub: "Вращение и ежедневная отметка", Icon: IconWheel },
  { to: "/upgrade", title: "Усиление", sub: "Прокачка параметров реактора", Icon: IconUp },
  { to: "/tower", title: "Башня", sub: "Игра: сложи башню без промаха", Icon: IconTower },
] as const;

const MINER_RU: Record<string, string> = {
  idle: "остановлен — запустите цикл",
  running: "цикл активен",
  ready: "хранилище полное — соберите",
};

/**
 * Появление главной — CSS вместо framer-motion (главная в стартовом чанке, библиотека анимаций туда не входит).
 * Повторяет прежний рисунок: контейнер проявляется за 0,3 с; блоки, что есть при первом кадре, — по очереди
 * (0,1 с + 0,08 с на каждый), поднимаясь на 16 px за 0,45 с; блоки, пришедшие позже с данными, — сразу.
 */
type Rise = "head" | "hero" | "spill" | "more" | "work";
const rise = (order: Rise[], k: Rise): { className: string; style?: CSSProperties } => {
  const i = order.indexOf(k);
  return { className: "home-rise", style: i >= 0 ? ({ "--rise-d": `${100 + i * 80}ms` } as CSSProperties) : undefined };
};

export function Home() {
  const { data: me, isLoading, error, isFetching } = useMe();
  const { data: miner } = useMiner();
  const daily = useDaily();
  // порядок блоков первого кадра — фиксируется один раз, как стаггер у framer-motion
  const first = useRef<Rise[] | null>(null);
  first.current ??= (["head", me && "hero", "spill", "more", me && "work"] as const).filter(Boolean) as Rise[];
  const r = (k: Rise) => rise(first.current!, k);
  // главная показана — в простое подтягиваем разделы, куда обычно идут дальше
  // вместе с майнером — кадр его интерьера (иначе он качается на тапе по башне и вход ждёт сеть)
  // и невидимый прогрев тяжёлых блоков Майнера (облик берём по последним данным), чтобы первый вход не был дороже повторных
  const level = useRef(1);
  level.current = miner ? reactorLevel(miner) : 1;
  useEffect(
    () =>
      prefetchLikely([
        () => prefetchInterior("reactor"),
        () => import("@/lib/warmMiner").then((w) => w.warmMinerView(level.current)),
      ]),
    [],
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

      {/* «окно в город»: полоса, где город не закрыт панелями (DESIGN.md п. 3.11) */}
      <CityWindow />

      {isLoading && <LoadingPanel label="Синхронизация контура…" />}
      {error && (
        <ErrorPanel message="Нет связи с сервером. Откройте приложение из Telegram." />
      )}

      {me && (
        <section {...r("hero")}>
          <Panel level="hero" see cut="l" lift="l2" className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="ui-label ui-shade">Баланс</p>
                <Num value={Number(me.balance).toFixed(4)} unit="TON" size="xl" glow className="ui-shade mt-2 block !text-[36px] !leading-[44px]" />
              </div>
              <Panel level="e0" cut="s" lift={false} className="shrink-0 px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[var(--text-3)]">
                  <IconUp size={12} />
                  <span className="ui-label">Уровень</span>
                </div>
                <Num value={me.level} size="l" className="mt-1 block !text-[24px] !leading-[28px]" />
                <p className="ui-sys mt-0.5">{me.xp} XP</p>
              </Panel>
            </div>

            <div className="mt-5">
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
          </Panel>
        </section>
      )}

      <div className={`${r("spill").className} ui-spill`} style={r("spill").style}>
        <Button
          kind="primary"
          size="lg"
          block
          className="!h-[60px] !justify-between !px-4 text-left"
          disabled={!daily.ready}
          aria-label={daily.countdown ? `Отметка получена. Следующая награда через ${daily.countdown}` : undefined}
          onClick={daily.claimNow}
        >
          <span className="flex items-center gap-3">
            {daily.waiting ? <IconCheck size={22} /> : <IconBolt size={22} />}
            <span>
              <span className="block text-[15px] leading-[20px]">
                {daily.pending ? "Начисление…" : daily.waiting ? "Отметка получена" : "Ежедневная отметка"}
              </span>
              <span className="block text-[11px] leading-[16px] tracking-[0.14em] opacity-80">
                {daily.countdown ? (
                  <>
                    Следующая награда через <span className="ui-num">{daily.countdown}</span>
                  </>
                ) : (
                  "Серия · награда · XP"
                )}
              </span>
            </span>
          </span>
          {!daily.waiting && <IconChevron size={20} />}
        </Button>
      </div>

      <div className={`${r("more").className} space-y-2.5`} style={r("more").style}>
        <SectionLabel>Ещё</SectionLabel>
        <List>
          {more.map((m) => {
            const Icon = m.Icon;
            return <ListRow key={m.to} to={m.to} icon={<Icon size={20} />} title={m.title} sub={m.sub} />;
          })}
        </List>
      </div>

      {me && (
        <div {...r("work")}>
          <WorkArea />
        </div>
      )}
    </div>
  );
}
