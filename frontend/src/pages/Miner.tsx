import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMiner, useMinerStart, useMinerClaim } from "@/api/hooks";
import { IconReactor } from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Gauge,
  Readout,
  Panel,
  Scrim,
  Num,
  Bar,
  StatTile,
  Button,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";

const statusTone = {
  idle: "neutral" as const,
  running: "live" as const,
  ready: "warn" as const,
};

const statusLabel: Record<string, string> = {
  idle: "Ожидание",
  running: "Цикл активен",
  ready: "Хранилище полное",
};

export function Miner() {
  const { data: m, isLoading, error } = useMiner();
  const start = useMinerStart();
  const claim = useMinerClaim();

  if (isLoading) return <LoadingPanel label="Синхронизация реактора…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить майнер" />;
  if (!m) return null;

  const accrued = Number(m.accrued_now ?? m.pending_reward);
  const cap = Number(m.storage_cap ?? m.estimated_reward ?? 0);
  const running = m.status === "running";
  const ready = m.status === "ready";

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Реактор"
        title="Майнер"
        action={
          <StatusPill tone={statusTone[m.status as keyof typeof statusTone] || "neutral"}>
            {statusLabel[m.status] || m.status}
          </StatusPill>
        }
      />

      {/* Герой: «окно в город» со скримом под цифрами */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Panel level="hero" see cut="l" lift="l2" className="p-5">
          <div className="relative flex flex-col items-center">
            <span className={`miner-core ${ready ? "is-ready" : running ? "is-running" : ""}`}>
              <IconReactor size={30} />
            </span>
            <p className="ui-label ui-shade mt-4">Накоплено в цикле</p>
            <Num value={accrued.toFixed(6)} unit="TON" size="l" glow={running || ready} tone={ready ? "amber" : undefined} className="ui-shade mt-1" />
            {m.cycle_hours != null && (
              <p className="ui-sec ui-shade mt-1">Длительность цикла ~{m.cycle_hours.toFixed(1)} ч</p>
            )}
          </div>

          <Scrim className="relative -mx-5 -mb-5 mt-5 flex items-center gap-5 px-5 pb-5 pt-4">
            <Gauge value={accrued} max={cap || 1} label="Хранилище" sub={`${accrued.toFixed(4)}`} />
            <div className="min-w-0 flex-1 space-y-3">
              <Readout label="Ёмкость" value={cap.toFixed(6)} unit="TON" />
              <Bar value={cap > 0 ? accrued / cap : 0} tone={ready ? "amber" : "neon"} label="Заполнение хранилища" />
              <p className="ui-sec !text-[12px] !leading-[16px]">
                {ready
                  ? "Хранилище заполнено — соберите награду, иначе фарм остановлен."
                  : running
                    ? "Реактор работает. Можно собрать до конца цикла."
                    : "Запустите цикл, чтобы начать накопление."}
              </p>
            </div>
          </Scrim>
        </Panel>
      </motion.div>

      {/* Характеристики реактора */}
      <div className="grid grid-cols-5 gap-2">
        {(
          [
            ["power", "Мощн.", m.power, "Мощность"],
            ["capacity", "Ёмк.", m.capacity, "Ёмкость"],
            ["acceleration", "Длит.", m.acceleration, "Длительность цикла"],
            ["luck", "Удача", m.luck, "Удача"],
            ["stability", "Стаб.", m.stability, "Стабильность"],
          ] as const
        ).map(([key, k, v, tip]) => (
          <StatTile key={key} label={k} value={v} title={tip} />
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {m.status === "idle" && (
          <span className="ui-spill">
            <Button kind="primary" size="lg" block disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "Запуск…" : "Запуск цикла"}
            </Button>
          </span>
        )}
        {(m.status === "running" || m.status === "ready") && (
          <span className={ready ? "ui-spill amber" : "ui-spill"}>
            <Button
              kind="primary"
              size="lg"
              block
              haptics="collect"
              className={ready ? "amber" : undefined}
              disabled={claim.isPending}
              onClick={() => claim.mutate()}
            >
              {claim.isPending ? "Сбор…" : ready ? "Собрать · хранилище полное" : "Собрать"}
            </Button>
          </span>
        )}
        <Link to="/upgrade" className="ui-btn secondary block lg no-underline" onClick={() => haptic.tap()}>
          Модуль усиления · двойное колесо
        </Link>
      </div>
    </div>
  );
}
