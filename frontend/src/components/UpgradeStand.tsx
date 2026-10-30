import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMe, useMiner, useMinerUpgrade, type UpgradeOut } from "@/api/hooks";
import { LoadingPanel, ErrorPanel, Readout, Panel, Num, Tag, Chip, Button, DialGauge, cx } from "@/components/ui";
import { prefersReducedMotion } from "@/components/ui/press";
import { haptic } from "@/lib/haptics";
import { IconSpark } from "@/components/icons";
import { formatLeft, useCountdown } from "@/lib/countdown";
import { reactorLevel, tierFor } from "@/lib/reactorTiers";
import { ReactorTierPanel } from "@/components/ReactorTierPanel";
import { useQueryClient } from "@tanstack/react-query";

export const TYPE_RU: Record<string, string> = {
  power: "Мощность",
  capacity: "Ёмкость",
  acceleration: "Длительность",
  luck: "Удача",
  stability: "Стабильность",
};

/** Короткие подписи плиток (вместо PWR/CAP/ACC/LUC/STB) */
const TYPE_SHORT: Record<string, string> = {
  power: "Мощн.",
  capacity: "Ёмк.",
  acceleration: "Длит.",
  luck: "Удача",
  stability: "Стаб.",
};

export const TYPES = ["power", "capacity", "acceleration", "luck", "stability"] as const;

type Phase = "idle" | "wait" | "scan" | "needle" | "done";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pctFmt = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n * 100) / 100)}%`;

/**
 * Стойка усиления реактора (DESIGN.md п. 8.2): циферблат шанса, «Стойка параметров» (Фокус/Запрет),
 * «Попытка усиления» и плашка результата. Живёт в шторке «Усиление реактора» на Майнере
 * (отдельный чанк — framer-motion грузится только при открытии шторки).
 */
export function UpgradeStand() {
  const { data: me } = useMe();
  const { data: m, isLoading, error } = useMiner({ fresh: true });
  const upgrade = useMinerUpgrade();
  const qc = useQueryClient();
  const cycleEnd = m?.status === "running" && m.session_ends_at ? Date.parse(m.session_ends_at) : null;
  const cycleLeft = useCountdown(Number.isFinite(cycleEnd) ? cycleEnd : null, 0, () => qc.invalidateQueries({ queryKey: ["miner"] }));
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [blockType, setBlockType] = useState<string | null>(null);
  const [last, setLast] = useState<UpgradeOut | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanAt, setScanAt] = useState<string | null>(null);
  const skip = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase !== "done") return;
    const id = window.setTimeout(
      () => resultRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }),
      80,
    );
    return () => window.clearTimeout(id);
  }, [phase]);
  const alive = useRef(true);
  useEffect(() => {
    try {
      localStorage.removeItem("upgrade:last-cost"); // запомненная цена из прошлой версии больше не нужна
    } catch {
      /* приватный режим */
    }
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Момент C (п. 13): сначала ответ сервера, потом показ. Подсветка сканирует статы и тормозит на выпавшем
   * (щелчок на каждом шаге), стрелка пробегает шкалу с перелётом, затем плашка результата. До 2.2 с, тап — пропуск.
   */
  async function run() {
    if (!m) return;
    skip.current = false;
    setPhase("wait");
    let res: UpgradeOut;
    try {
      res = await upgrade.mutateAsync({ use_focus_on: focusOn, block_type: blockType });
    } catch {
      if (alive.current) setPhase("idle");
      return;
    }
    if (!alive.current) return;
    if (!prefersReducedMotion()) {
      setLast(null);
      setPhase("scan");
      const target = Math.max(0, TYPES.indexOf(res.upgrade_type as (typeof TYPES)[number]));
      const steps = 5 + target; // круг с торможением, последний шаг — выпавший тип
      for (let i = 0; i <= steps && !skip.current; i++) {
        setScanAt(TYPES[i % TYPES.length]);
        haptic.select();
        await sleep(40 + i * i * 2.2);
      }
      if (!alive.current) return;
      setScanAt(res.upgrade_type);
      setLast(res);
      setPhase("needle");
      if (!skip.current) await sleep(800);
      if (!alive.current) return;
    } else {
      setScanAt(res.upgrade_type);
      setLast(res);
    }
    setPhase("done");
    if (res.success) haptic.success();
    else haptic.error();
  }

  if (isLoading) return <LoadingPanel label="Калибровка модуля усиления…" />;
  if (error) return <ErrorPanel message="Канал майнера недоступен" />;
  if (!m) return null;

  const spinning = phase === "wait" || phase === "scan" || phase === "needle";
  const busy = upgrade.isPending || spinning;
  const animating = phase === "scan" || phase === "needle";
  // цена с сервера (та же формула, что и списание); у старого сервера поля нет — строку не показываем
  const cost = m.upgrade_cost != null && Number.isFinite(Number(m.upgrade_cost)) ? Number(m.upgrade_cost) : null;

  // Кнопка отражает доступность (п. 14, правило 13): причина видна до нажатия, а не ошибкой после
  const balance = me ? Number(me.balance) : null;
  const inCycle = m.status === "running";
  const short = cost != null && balance != null && balance < cost ? cost - balance : null;
  const blockReason = inCycle
    ? "Реактор в цикле — усиление доступно, когда цикл закончится."
    : short != null
      ? `Не хватает ${short.toFixed(4)} TON. Пополните баланс майнингом, заданиями или промокодом.`
      : null;
  const focusN = me?.focus_tokens ?? 0;
  const blockN = me?.block_tokens ?? 0;
  const canFocus = focusN > 0;
  const canBlock = blockN > 0;

  const chance = last && phase !== "scan" ? last.success_chance_bp / 10000 : null;
  const boost = (me?.success_boost_bp ?? 0) / 100;
  const level = reactorLevel(m);
  const tier = tierFor(level);
  const capBonus = m.capacity_bonus_pct ?? null;
  const luckLo = m.luck_min_pct ?? null;
  const luckHi = m.luck_max_pct ?? null;

  return (
    <div
      className="us-stand space-y-4"
      onPointerDown={() => {
        if (animating) skip.current = true;
      }}
    >
      {/* Циферблат шанса (п. 8.2): в шторке — 220 px, без табло под ним (баланс — у кнопки) */}
      <Panel level="hero" cut="l" className="px-4 pb-4 pt-3">
        <DialGauge chance={chance} className={cx("us-dial", phase === "needle" && "is-run")} />
        <div className="-mt-1 flex flex-col items-center text-center">
          <Num value={chance != null ? Math.round(chance * 100) : "—"} decode={false} unit={chance != null ? "%" : undefined} size="l" glow={chance != null} className="ui-shade" />
          <p className="ui-label ui-shade mt-1">
            {chance != null
              ? `Успех ${Math.round(chance * 100)}% / Сгорание ${100 - Math.round(chance * 100)}%`
              : phase === "scan"
                ? "Выбор параметра…"
                : "Шанс покажет попытка"}
          </p>
          {boost > 0 && (
            <p className="ui-sys mt-1">бонус +{Number(boost.toFixed(1))}% к шансу следующей попытки</p>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <p className="ui-label whitespace-nowrap">Стойка параметров</p>
          <span className="flex gap-1.5">
            <Chip label="Фокус" value={focusN} className={cx(!canFocus && "is-off")} />
            <Chip label="Запрет" value={blockN} className={cx(!canBlock && "is-off")} />
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {TYPES.map((t) => {
            const val = m[t] as number;
            const focused = focusOn === t;
            const blocked = blockType === t;
            const scanned = scanAt === t && (animating || phase === "done");
            return (
              <button
                key={t}
                type="button"
                disabled={busy || (!canFocus && !canBlock && !focused && !blocked)}
                onClick={() => {
                  // цикл пропускает метку, если жетонов нет: нельзя выбрать то, что сервер отклонит
                  if (focused) {
                    setFocusOn(null);
                    if (canBlock) setBlockType(t);
                  } else if (blocked) {
                    setBlockType(null);
                  } else if (canFocus) {
                    setFocusOn(t);
                    if (blockType === t) setBlockType(null);
                  } else if (canBlock) {
                    setBlockType(t);
                  }
                }}
                title={TYPE_RU[t]}
                aria-label={`${TYPE_RU[t]}, ур. ${val}${focused ? ", фокус" : blocked ? ", запрет" : ""}`}
                aria-pressed={focused || blocked}
                className={cx("ui-stat", focused && "focus", blocked && "blocked", scanned && "scan")}
              >
                <span className="k block">{TYPE_SHORT[t]}</span>
                <span className="v block">{val}</span>
                <span className="p block">{focused ? "фокус" : blocked ? "запрет" : "\u00a0"}</span>
              </button>
            );
          })}
        </div>
        <p className="ui-sec mt-3 !text-[12px] !leading-[16px]">
          {canFocus || canBlock
            ? "Тап по параметру: Фокус → Запрет → сброс. Параметр выбирается при попытке."
            : "Жетонов Фокус и Запрет нет — их дают колесо удачи, ежедневная отметка и промокоды."}
        </p>
        {(capBonus != null || (luckLo != null && luckHi != null)) && (
          <p className="ui-sec mt-1 !text-[12px] !leading-[16px]">
            {capBonus != null && (
              <>
                Ёмкость ур. {m.capacity}: <span className="ui-num text-[var(--text)]">{pctFmt(capBonus)}</span> TON за цикл
              </>
            )}
            {capBonus != null && luckLo != null && luckHi != null && " · "}
            {luckLo != null && luckHi != null && (
              <>
                Удача ур. {m.luck}: сбор{" "}
                <span className="ui-num text-[var(--text)]">
                  {luckLo === 0 && luckHi === 0 ? "без разброса" : `${pctFmt(luckLo)}…${pctFmt(luckHi)}`}
                </span>
              </>
            )}
          </p>
        )}
      </Panel>

      <Panel className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-h">
              {phase === "wait" ? "Связь с модулем…" : phase === "scan" ? "Выбор параметра" : phase === "needle" ? "Бросок шанса" : "Попытка усиления"}
            </p>
            {animating && <p className="ui-sec !text-[12px]">Тап по экрану — сразу к результату</p>}
          </div>
          {spinning ? (
            <Tag tone="neon">идёт</Tag>
          ) : cost != null ? (
            <Num value={cost.toFixed(4)} unit="TON" size="s" decode={false} />
          ) : null}
        </div>
        <span className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy || !!blockReason} aria-describedby="upgrade-why" onClick={run}>
            {busy ? "Усиление…" : inCycle ? (cycleLeft != null ? `Доступно через ${formatLeft(cycleLeft)}` : "Реактор в цикле") : short != null ? "Не хватает TON" : "Усилить"}
          </Button>
        </span>
        {!busy && (
          <p id="upgrade-why" className="ui-sec !text-[12px] !leading-[16px]">
            {blockReason ?? (
              <>
                Провал — стоимость сгорает · баланс <span className="ui-num text-[var(--text)]">{me ? Number(me.balance).toFixed(4) : "—"}</span> TON
              </>
            )}
          </p>
        )}

        {upgrade.isError && <ErrorPanel message={upgrade.error instanceof Error ? upgrade.error.message : "Отказ модуля"} />}
      </Panel>

      <AnimatePresence mode="wait">
        {last && !spinning && (
          <motion.div
            key={`${last.upgrade_type}-${last.success}-${last.cost}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            ref={resultRef}
            className="scroll-mb-6"
          >
            <Panel danger={!last.success} className={cx("p-4", phase === "done" && !last.success && "ui-burn")}>
              <div className="flex items-center justify-between">
                <p className="ui-label">{last.success ? "Закреплено" : "Сгорание"}</p>
                <span className={cx("ui-verdict", last.success ? "ok" : "burn", phase === "done" && last.success && "ui-ignite")}>
                  {last.success ? "Успех" : `Сгорело −${Number(last.cost).toFixed(4)} TON`}
                </span>
              </div>
              <p className="ui-h mt-2 !text-[18px]">
                {TYPE_RU[last.upgrade_type] || last.upgrade_type}
                {last.success && last.new_level != null && (
                  <span className="ui-num text-[var(--text-2)]">
                    {" "}
                    {last.new_level - 1} → <span className={cx(phase === "done" && "ui-roll")}>{last.new_level}</span>
                  </span>
                )}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Readout label="Стоимость" value={Number(last.cost).toFixed(4)} unit="TON" />
                <Readout label="Шанс" value={`${(last.success_chance_bp / 100).toFixed(1)}`} unit="%" />
              </div>
              {last.burned && !last.success && <p className="ui-sec mt-3 !text-[12px] !text-[var(--magenta)]">Сумма списана без возврата.</p>}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Облик реактора и путь к следующему — бывшая панель под героем Майнера */}
      <ReactorTierPanel tier={tier} level={level} />
    </div>
  );
}

export default UpgradeStand;
