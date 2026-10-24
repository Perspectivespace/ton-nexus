import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useMiner, useMinerUpgrade, type UpgradeOut } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
  Panel,
  Scrim,
  Num,
  Tag,
  Button,
  DialGauge,
  cx,
} from "@/components/ui";
import { prefersReducedMotion } from "@/components/ui/press";
import { haptic } from "@/lib/haptics";
import { IconSpark } from "@/components/icons";

const TYPE_RU: Record<string, string> = {
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

const TYPES = ["power", "capacity", "acceleration", "luck", "stability"] as const;

/** Последняя известная цена прогона и сумма уровней, при которой она была (цена зависит только от суммы уровней) */
const COST_KEY = "upgrade:last-cost";
type CostMemo = { cost: string; total: number };
function readCost(): CostMemo | null {
  try {
    const v = JSON.parse(localStorage.getItem(COST_KEY) || "null");
    return v && typeof v.cost === "string" && typeof v.total === "number" ? v : null;
  } catch {
    return null;
  }
}

type Phase = "idle" | "wait" | "scan" | "needle" | "done";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Upgrade() {
  const { data: me } = useMe();
  const { data: m, isLoading, error } = useMiner();
  const upgrade = useMinerUpgrade();
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [blockType, setBlockType] = useState<string | null>(null);
  const [last, setLast] = useState<UpgradeOut | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [costMemo, setCostMemo] = useState<CostMemo | null>(readCost);
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
    const total = m.power + m.capacity + m.acceleration + m.luck + m.stability;
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
    const memo = { cost: res.cost, total };
    try {
      localStorage.setItem(COST_KEY, JSON.stringify(memo));
    } catch {
      /* приватный режим */
    }
    setCostMemo(memo);
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
  const total = m.power + m.capacity + m.acceleration + m.luck + m.stability;
  const costExact = costMemo && costMemo.total === total ? Number(costMemo.cost) : null;
  const costFloor = costMemo && costMemo.total < total ? Number(costMemo.cost) : null;

  const chance = last && phase !== "scan" ? last.success_chance_bp / 10000 : null;
  const boost = (me?.success_boost_bp ?? 0) / 100;

  return (
    <div
      className="space-y-5"
      onPointerDown={() => {
        if (animating) skip.current = true;
      }}
    >
      <ScreenHeader
        eyebrow="Модуль"
        title="Усиление"
        action={
          <Link to="/miner" className="ui-btn secondary sm no-underline">
            ← Реактор
          </Link>
        }
      />

      {/* Герой: циферблат шанса (п. 8.2) */}
      <Panel level="hero" cut="l" lift="l2" className="px-4 pb-0 pt-4">
        <DialGauge chance={chance} className={cx(phase === "needle" && "is-run")} />
        <div className="-mt-2 flex flex-col items-center text-center">
          <Num value={chance != null ? Math.round(chance * 100) : "—"} decode={false} unit={chance != null ? "%" : undefined} size="xl" glow={chance != null} className="ui-shade" />
          <p className="ui-label ui-shade mt-1">
            {chance != null
              ? `Успех ${Math.round(chance * 100)}% / Сгорание ${100 - Math.round(chance * 100)}%`
              : phase === "scan"
                ? "Выбор параметра…"
                : "Шанс покажет прогон"}
          </p>
          {boost > 0 && <p className="ui-sys mt-1">бонус к шансу +{boost.toFixed(1)}%</p>}
        </div>
        <Scrim className="relative -mx-4 mt-4 grid grid-cols-3 gap-3 px-4 pb-4 pt-3">
          <Readout label="Баланс" value={me ? Number(me.balance).toFixed(4) : "—"} unit="TON" />
          <Readout label="Фокус" value={String(me?.focus_tokens ?? 0)} hint="вес типа ×" />
          <Readout label="Запрет" value={String(me?.block_tokens ?? 0)} hint="блок типа" />
        </Scrim>
      </Panel>

      <Panel className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="ui-label">Стойка параметров</p>
          <StatusPill tone={busy ? "live" : "neutral"}>
            {busy ? "прогон" : "готов"}
          </StatusPill>
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
                disabled={busy}
                onClick={() => {
                  if (focused) {
                    setFocusOn(null);
                    setBlockType(t);
                  } else if (blocked) {
                    setBlockType(null);
                  } else {
                    setFocusOn(t);
                    if (blockType === t) setBlockType(null);
                  }
                }}
                title={TYPE_RU[t]}
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
        <p className="ui-sec mt-3 !text-[12px] !leading-[16px]">Тап: Фокус → Запрет → сброс. Параметр выбирает прогон.</p>
      </Panel>

      <Panel className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-h">
              {phase === "wait" ? "Связь с модулем…" : phase === "scan" ? "Выбор параметра" : phase === "needle" ? "Бросок шанса" : "Прогон усиления"}
            </p>
            <p className="ui-sec !text-[12px]">
              {animating ? "Тап по экрану — сразу к результату" : "1) параметр · 2) шанс · провал — стоимость сгорает"}
            </p>
          </div>
          {spinning && <Tag tone="neon">идёт</Tag>}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="ui-label">Стоимость прогона</span>
          {costExact != null ? (
            <Num value={costExact.toFixed(4)} unit="TON" size="s" decode={false} />
          ) : costFloor != null ? (
            <span className="ui-sys">не меньше {costFloor.toFixed(4)} TON</span>
          ) : (
            <span className="ui-sys">станет известна после первого прогона</span>
          )}
        </div>
        <span className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy} onClick={run}>
            {busy ? "Прогон…" : costExact != null ? `Запустить · ${costExact.toFixed(4)} TON` : "Запустить прогон"}
          </Button>
        </span>

        {upgrade.isError && (
          <ErrorPanel
            message={upgrade.error instanceof Error ? upgrade.error.message : "Отказ модуля"}
          />
        )}
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
            className="scroll-mb-28"
          >
            <Panel danger={!last.success} className={cx("p-5", phase === "done" && !last.success && "ui-burn")}>
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
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Readout label="Стоимость" value={Number(last.cost).toFixed(4)} unit="TON" />
                <Readout label="Шанс" value={`${(last.success_chance_bp / 100).toFixed(1)}`} unit="%" />
              </div>
              {last.burned && !last.success && (
                <p className="ui-sec mt-3 !text-[12px] !text-[var(--magenta)]">Сумма списана без возврата.</p>
              )}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
