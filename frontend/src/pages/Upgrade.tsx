import { useState } from "react";
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
} from "@/components/ui";
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

export function Upgrade() {
  const { data: me } = useMe();
  const { data: m, isLoading, error } = useMiner();
  const upgrade = useMinerUpgrade();
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [blockType, setBlockType] = useState<string | null>(null);
  const [last, setLast] = useState<UpgradeOut | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinLabel, setSpinLabel] = useState("Тип…");

  async function run() {
    setSpinning(true);
    setSpinLabel("Колесо типа");
    await new Promise((r) => setTimeout(r, 700));
    setSpinLabel("Колесо шанса");
    await new Promise((r) => setTimeout(r, 550));
    try {
      const res = await upgrade.mutateAsync({
        use_focus_on: focusOn,
        block_type: blockType,
      });
      setLast(res);
    } catch {
      /* */
    } finally {
      setSpinning(false);
    }
  }

  if (isLoading) return <LoadingPanel label="Калибровка модуля усиления…" />;
  if (error) return <ErrorPanel message="Канал майнера недоступен" />;
  if (!m) return null;

  const busy = upgrade.isPending || spinning;

  const chance = last ? last.success_chance_bp / 10000 : null;
  const boost = (me?.success_boost_bp ?? 0) / 100;

  return (
    <div className="space-y-5">
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
        <DialGauge chance={chance} />
        <div className="-mt-2 flex flex-col items-center text-center">
          <Num value={chance != null ? Math.round(chance * 100) : "—"} unit={chance != null ? "%" : undefined} size="xl" glow={chance != null} className="ui-shade" />
          <p className="ui-label ui-shade mt-1">
            {chance != null
              ? `Успех ${Math.round(chance * 100)}% / Сгорание ${100 - Math.round(chance * 100)}%`
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
            {busy ? "вращение" : "двойное колесо"}
          </StatusPill>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {TYPES.map((t) => {
            const val = m[t] as number;
            const focused = focusOn === t;
            const blocked = blockType === t;
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
                className={`ui-stat${focused ? " focus" : blocked ? " blocked" : ""}`}
              >
                <span className="k block">{TYPE_SHORT[t]}</span>
                <span className="v block">{val}</span>
                <span className="p block">{focused ? "фокус" : blocked ? "запрет" : "\u00a0"}</span>
              </button>
            );
          })}
        </div>
        <p className="ui-sec mt-3 !text-[12px] !leading-[16px]">Тап: Фокус → Запрет → сброс. Тип выбирает колесо.</p>
      </Panel>

      <Panel className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-h">{spinning ? spinLabel : "Прогон усиления"}</p>
            <p className="ui-sec !text-[12px]">1) тип · 2) шанс · провал = ставка сгорает</p>
          </div>
          {spinning && <Tag tone="neon">идёт</Tag>}
        </div>

        <span className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy} onClick={run}>
            {busy ? "Прокрутка…" : "Запустить колесо"}
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
          >
            <Panel danger={!last.success} className="p-5">
              <div className="flex items-center justify-between">
                <p className="ui-label">{last.success ? "Закреплено" : "Сгорание"}</p>
                <StatusPill tone={last.success ? "ok" : "danger"}>
                  {last.success ? "успех" : "сгорание"}
                </StatusPill>
              </div>
              <p className="ui-h mt-2 !text-[18px]">
                {TYPE_RU[last.upgrade_type] || last.upgrade_type}
                {last.success && last.new_level != null && (
                  <span className="ui-num text-[var(--text-2)]"> → {last.new_level}</span>
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
