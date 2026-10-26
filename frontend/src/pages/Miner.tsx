import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe, useMiner, useMinerStart, useMinerClaim } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
  Panel,
  Scrim,
  Num,
  Reactor,
  StatTile,
  Button,
  useToast,
  useIgniteOnce,
  useLiveAccrued,
  cx,
} from "@/components/ui";
import { prefersReducedMotion } from "@/components/ui/press";
import { haptic } from "@/lib/haptics";
import { markTierSeen, reactorLevel, seenTier, tierFor } from "@/lib/reactorTiers";
import { ReactorTierPanel } from "@/components/ReactorTierPanel";

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
  const { data: m, isLoading, error, dataUpdatedAt } = useMiner();
  const { data: me } = useMe();
  const start = useMinerStart();
  const claim = useMinerClaim();
  const toast = useToast();

  const accrued = Number(m?.accrued_now ?? m?.pending_reward ?? 0);
  const cap = Number(m?.storage_cap ?? m?.estimated_reward ?? 0);
  const running = m?.status === "running";
  const ready = m?.status === "ready";

  // Живой счётчик: 4 раза в секунду, без расшифровки (п. 13 B)
  const live = useLiveAccrued({
    accrued,
    cap,
    running,
    startedAt: m?.session_started_at,
    endsAt: m?.session_ends_at,
    fetchedAt: dataUpdatedAt,
  });
  // Момент A: неон зажигается один раз за сессию, если реактор горит
  const ignite = useIgniteOnce("miner", running || ready);

  // Облик реактора по уровню: раскрытие и тост «Новый облик» — один раз за облик на устройстве (п. 8.1.1)
  const level = m ? reactorLevel(m) : 1;
  const tier = tierFor(level);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (!m) return;
    const seen = seenTier();
    if (tier.id <= seen) {
      if (tier.id < seen) markTierSeen(tier.id);
      return;
    }
    const reduce = prefersReducedMotion();
    setReveal(true);
    const t1 = window.setTimeout(() => {
      markTierSeen(tier.id);
      haptic.success();
      toast({ kind: "ok", title: `Новый облик: «${tier.name}»`, sub: `Реактор ${tier.mk} · ${tier.look}` });
    }, reduce ? 0 : 1500);
    const t2 = window.setTimeout(() => setReveal(false), reduce ? 300 : 2400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [m == null, tier.id]); // toast стабилен, m нужен только как «загрузился»

  // Момент B: после «Собрать» дуга стекает 600 мс и держится на нуле, пока не придут свежие данные
  const [claimAt, setClaimAt] = useState<number | null>(null);
  const [gain, setGain] = useState<string | null>(null);
  const updatedRef = useRef(dataUpdatedAt);
  updatedRef.current = dataUpdatedAt;
  useEffect(() => {
    if (claimAt == null) return;
    const wait = Math.max(0, claimAt + 600 - Date.now());
    const id = window.setTimeout(() => {
      if (updatedRef.current > claimAt || Date.now() - claimAt > 3000) setClaimAt(null);
    }, wait);
    const hard = window.setTimeout(() => setClaimAt(null), 3000);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(hard);
    };
  }, [claimAt, dataUpdatedAt]);
  useEffect(() => {
    if (!gain) return;
    const id = window.setTimeout(() => setGain(null), 1800);
    return () => window.clearTimeout(id);
  }, [gain]);

  function onClaim() {
    claim.mutate(undefined, {
      onSuccess: (r) => {
        const sum = `+${Number(r.claimed).toFixed(6)}`;
        const reduce = prefersReducedMotion();
        setClaimAt(Date.now());
        setGain(sum);
        window.setTimeout(
          () => {
            haptic.success();
            toast({ kind: "ok", title: "Собрано", sub: `${sum} TON` });
          },
          reduce ? 0 : 600,
        );
      },
      onError: (e) => toast({ kind: "danger", title: "Сбор не прошёл", sub: e.message }),
    });
  }

  if (isLoading) return <LoadingPanel label="Синхронизация реактора…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить майнер" />;
  if (!m) return null;

  const draining = claimAt != null;
  const shown = draining ? 0 : live;

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="Майнер"
        action={
          <StatusPill tone={statusTone[m.status as keyof typeof statusTone] || "neutral"}>
            {statusLabel[m.status] || m.status}
          </StatusPill>
        }
      />

      {/* Герой: «окно в город» со скримом под цифрами */}
      {/* появление героя — CSS (прежняя пружина framer-motion в linear()), чтобы чанк «Майнера» не ждал библиотеку анимаций */}
      <div className="mn-rise">
        <Panel level="hero" see cut="l" lift="l2" className="p-5">
          <div className="relative flex flex-col items-center">
            <Reactor
              fill={cap > 0 ? shown / cap : 0}
              state={ready ? "ready" : running ? "running" : "idle"}
              draining={draining}
              ignite={ignite}
              tier={tier.id}
              reveal={reveal}
            />
            <p className="ui-label ui-shade mt-6">Накоплено в цикле</p>
            <Num
              value={shown.toFixed(6)}
              unit="TON"
              size="l"
              decode={false}
              glow={running || ready}
              tone={ready ? "amber" : undefined}
              className={cx("ui-shade mt-1", ignite && "ui-ignite")}
            />
            {m.cycle_hours != null && (
              <p className="ui-sec ui-shade mt-1">Длительность цикла ~{m.cycle_hours.toFixed(1)} ч</p>
            )}
          </div>

          <Scrim className="relative -mx-5 -mb-5 mt-5 px-5 pb-5 pt-4">
            <div className="min-w-0 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <Readout label="Ёмкость" value={cap.toFixed(6)} unit="TON" />
                <div className="relative min-w-0">
                  <p className="ui-label">Баланс</p>
                  <Num value={me ? Number(me.balance).toFixed(4) : "—"} unit="TON" size="m" className="mt-1 block truncate !text-[19px] !font-bold" />
                  {gain && (
                    <span className="ui-gain" aria-live="polite">
                      {gain}
                    </span>
                  )}
                </div>
              </div>
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
      </div>

      <ReactorTierPanel tier={tier} level={level} />

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
            <Button kind="primary" size="lg" block disabled={start.isPending} onClick={() =>
                start.mutate(undefined, {
                  onSuccess: () => toast({ kind: "ok", title: "Цикл запущен", sub: "реактор копит TON в хранилище" }),
                  onError: (e) => toast({ kind: "danger", title: "Цикл не запустился", sub: e.message }),
                })
              }>
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
              onClick={onClaim}
            >
              {claim.isPending ? "Сбор…" : ready ? "Собрать · хранилище полное" : "Собрать"}
            </Button>
          </span>
        )}
        <Link to="/upgrade" className="ui-btn secondary block lg no-underline" onClick={() => haptic.tap()}>
          Усиление реактора
        </Link>
      </div>
    </div>
  );
}
