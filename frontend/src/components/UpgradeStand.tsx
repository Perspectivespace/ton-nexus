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
import { t } from "@/i18n";

export const TYPE_RU: Record<string, string> = {
  get power() { return t("stat.power"); },
  get capacity() { return t("stat.capacity"); },
  get acceleration() { return t("stat.acceleration"); },
  get luck() { return t("stat.luck"); },
  get stability() { return t("stat.stability"); },
};

/** Короткие подписи плиток (вместо PWR/CAP/ACC/LUC/STB) */
const TYPE_SHORT: Record<string, string> = {
  get power() { return t("stat.powerShort"); },
  get capacity() { return t("stat.capacityShort"); },
  get acceleration() { return t("stat.accelerationShort"); },
  get luck() { return t("stat.luckShort"); },
  get stability() { return t("stat.stabilityShort"); },
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

  if (isLoading) return <LoadingPanel label={t("upgrade.calibrating")} />;
  if (error) return <ErrorPanel message={t("upgrade.channelDown")} />;
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
    ? t("upgrade.inCycle")
    : short != null
      ? t("upgrade.short", { short: short.toFixed(4) })
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
              ? t("upgrade.oddsAria", { chance: Math.round(chance * 100), v: 100 - Math.round(chance * 100) })
              : phase === "scan"
                ? t("upgrade.picking")
                : t("upgrade.oddsOnTry")}
          </p>
          {boost > 0 && (
            <p className="ui-sys mt-1">{t("upgrade.bonus")}{Number(boost.toFixed(1))}{t("upgrade.bonusTail")}</p>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <p className="ui-label whitespace-nowrap">{t("upgrade.rack")}</p>
          <span className="flex gap-1.5">
            <Chip label={t("token.focus")} value={focusN} className={cx(!canFocus && "is-off")} />
            <Chip label={t("token.block")} value={blockN} className={cx(!canBlock && "is-off")} />
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {TYPES.map((ty) => {
            const val = m[ty] as number;
            const focused = focusOn === ty;
            const blocked = blockType === ty;
            const scanned = scanAt === ty && (animating || phase === "done");
            return (
              <button
                key={ty}
                type="button"
                disabled={busy || (!canFocus && !canBlock && !focused && !blocked)}
                onClick={() => {
                  // цикл пропускает метку, если жетонов нет: нельзя выбрать то, что сервер отклонит
                  if (focused) {
                    setFocusOn(null);
                    if (canBlock) setBlockType(ty);
                  } else if (blocked) {
                    setBlockType(null);
                  } else if (canFocus) {
                    setFocusOn(ty);
                    if (blockType === ty) setBlockType(null);
                  } else if (canBlock) {
                    setBlockType(ty);
                  }
                }}
                title={TYPE_RU[ty]}
                aria-label={t("upgrade.statAria", { ty: TYPE_RU[ty], val, blocked: focused ? t("upgrade.focusAria") : blocked ? t("upgrade.blockAria") : "" })}
                aria-pressed={focused || blocked}
                className={cx("ui-stat", focused && "focus", blocked && "blocked", scanned && "scan")}
              >
                <span className="k block">{TYPE_SHORT[ty]}</span>
                <span className="v block">{val}</span>
                <span className="p block">{focused ? t("upgrade.focusLower") : blocked ? t("upgrade.blockLower") : "\u00a0"}</span>
              </button>
            );
          })}
        </div>
        <p className="ui-sec mt-3 !text-[12px] !leading-[16px]">
          {canFocus || canBlock
            ? t("upgrade.tapHint")
            : t("upgrade.noTokens")}
        </p>
        {(capBonus != null || (luckLo != null && luckHi != null)) && (
          <p className="ui-sec mt-1 !text-[12px] !leading-[16px]">
            {capBonus != null && (
              <>
                {t("upgrade.capLvl")}{" "}{m.capacity}: <span className="ui-num text-[var(--text)]">{pctFmt(capBonus)}</span>{" "}{t("upgrade.tonPerCycle")}</>
            )}
            {capBonus != null && luckLo != null && luckHi != null && " · "}
            {luckLo != null && luckHi != null && (
              <>
                {t("upgrade.luckLvl")}{" "}{m.luck}{t("upgrade.collect")}{" "}
                <span className="ui-num text-[var(--text)]">
                  {luckLo === 0 && luckHi === 0 ? t("upgrade.noSpread") : `${pctFmt(luckLo)}…${pctFmt(luckHi)}`}
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
              {phase === "wait" ? t("upgrade.linking") : phase === "scan" ? t("upgrade.phasePick") : phase === "needle" ? t("upgrade.phaseRoll") : t("upgrade.phaseTry")}
            </p>
            {animating && <p className="ui-sec !text-[12px]">{t("upgrade.tapSkip")}</p>}
          </div>
          {spinning ? (
            <Tag tone="neon">{t("upgrade.running")}</Tag>
          ) : cost != null ? (
            <Num value={cost.toFixed(4)} unit="TON" size="s" decode={false} />
          ) : null}
        </div>
        <span className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy || !!blockReason} aria-describedby="upgrade-why" onClick={run}>
            {busy ? t("upgrade.boosting") : inCycle ? (cycleLeft != null ? t("upgrade.availableIn", { cycleLeft: formatLeft(cycleLeft) }) : t("upgrade.reactorInCycle")) : short != null ? t("upgrade.notEnoughTon") : t("upgrade.boost")}
          </Button>
        </span>
        {!busy && (
          <p id="upgrade-why" className="ui-sec !text-[12px] !leading-[16px]">
            {blockReason ?? (
              <>
                {t("upgrade.failNote")}{" "}<span className="ui-num text-[var(--text)]">{me ? Number(me.balance).toFixed(4) : "—"}</span> TON
              </>
            )}
          </p>
        )}

        {upgrade.isError && <ErrorPanel message={upgrade.error instanceof Error ? upgrade.error.message : t("upgrade.moduleFail")} />}
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
                <p className="ui-label">{last.success ? t("upgrade.locked") : t("upgrade.burn")}</p>
                <span className={cx("ui-verdict", last.success ? "ok" : "burn", phase === "done" && last.success && "ui-ignite")}>
                  {last.success ? t("upgrade.success") : t("upgrade.burned", { cost: Number(last.cost).toFixed(4) })}
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
                <Readout label={t("upgrade.cost")} value={Number(last.cost).toFixed(4)} unit="TON" />
                <Readout label={t("upgrade.chance")} value={`${(last.success_chance_bp / 100).toFixed(1)}`} unit="%" />
              </div>
              {last.burned && !last.success && <p className="ui-sec mt-3 !text-[12px] !text-[var(--magenta)]">{t("upgrade.noRefund")}</p>}
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
