import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useDailyStatus,
  useDailyClaimFull,
  useWheelStatus,
  useWheelSpin,
  usePromoRedeem,
  type SpinOut,
  type DailyClaim,
  type PromoRedeemOut,
} from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
} from "@/components/ui";
import { IconSpark } from "@/components/icons";

const PRIZES = [
  {
    id: "success_plus_5",
    label: "+5% к успеху",
    short: "+5%",
    weight: 8,
    color: "#5cbf8a",
    use: "Добавляет +5% к шансу успеха следующей попытки усиления майнера (double-wheel). Не гарантирует успех, но даёт преимущество.",
  },
  {
    id: "focus_1",
    label: "Фокус ×1",
    short: "Фокус",
    weight: 15,
    color: "#7a9fd4",
    use: "Токен Фокус: перед усилением повышает вес выбранного типа апгрейда на колесе типа (чаще выпадает нужный стат). Расходуется при использовании.",
  },
  {
    id: "block_1",
    label: "Запрет ×1",
    short: "Запрет",
    weight: 12,
    color: "#9b8fd4",
    use: "Токен Запрет: блокирует выпадение одного нежелательного типа апгрейда на колесе типа. Расходуется при использовании.",
  },
  {
    id: "xp_small",
    label: "XP",
    short: "XP",
    weight: 25,
    color: "#d4b46a",
    use: "Опыт для прокачки уровня аккаунта. Уровни открывают доступ и бонусы по экономике проекта.",
  },
  {
    id: "ton_dust",
    label: "Пыль TON",
    short: "TON",
    weight: 20,
    color: "#6eb8c9",
    use: "Небольшая сумма TON сразу на баланс (пыль).",
  },
  {
    id: "nothing",
    label: "Пусто",
    short: "—",
    weight: 20,
    color: "#5e6678",
    use: "Пустой сектор — награда не начисляется. Часть экономики колеса.",
  },
] as const;

const WEIGHT_SUM = PRIZES.reduce((s, p) => s + p.weight, 0);
const SEG = 360 / PRIZES.length;

type Tab = "wheel" | "daily" | "promo";

const TABS: { key: Tab; label: string; glow: string }[] = [
  { key: "wheel", label: "Колесо", glow: "rgba(122,159,212,0.35)" },
  { key: "daily", label: "Чекин", glow: "rgba(212,180,106,0.3)" },
  { key: "promo", label: "Промо", glow: "rgba(111,191,154,0.3)" },
];

function prizeIndex(itemId: string): number {
  const i = PRIZES.findIndex((p) => p.id === itemId);
  return i >= 0 ? i : PRIZES.length - 1;
}

function targetOffset(index: number): number {
  const center = index * SEG + SEG / 2;
  return 360 - center;
}

function chancePct(weight: number): string {
  return `${((weight / WEIGHT_SUM) * 100).toFixed(0)}%`;
}

function FortuneWheel({ rotation, spinning }: { rotation: number; spinning: boolean }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;

  const slices = useMemo(() => {
    return PRIZES.map((p, i) => {
      const a0 = ((i * SEG - 90) * Math.PI) / 180;
      const a1 = (((i + 1) * SEG - 90) * Math.PI) / 180;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`;
      const mid = ((i * SEG + SEG / 2 - 90) * Math.PI) / 180;
      const tx = cx + r * 0.62 * Math.cos(mid);
      const ty = cy + r * 0.62 * Math.sin(mid);
      return { p, path, tx, ty };
    });
  }, [cx, cy, r]);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div
        className="pointer-events-none absolute -inset-4 rounded-full"
        style={{
          background: spinning
            ? "radial-gradient(circle, rgba(155,184,224,0.28), transparent 65%)"
            : "radial-gradient(circle, rgba(122,159,212,0.14), transparent 65%)",
          filter: "blur(12px)",
          animation: spinning ? "wheel-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-0.5">
        <div
          className="h-0 w-0 border-l-[8px] border-r-[8px] border-t-[14px] border-l-transparent border-r-transparent"
          style={{
            borderTopColor: "#9bb8e0",
            filter: "drop-shadow(0 0 6px rgba(155,184,224,0.7))",
          }}
        />
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative z-10">
        <defs>
          <radialGradient id="wbg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0c1220" />
            <stop offset="100%" stopColor="#06080e" />
          </radialGradient>
          <filter id="wglow">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke="rgba(155,184,224,0.2)" strokeWidth={2} />
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
          const major = i % 6 === 0;
          const r1 = r + 3;
          const r2 = r + (major ? 7 : 5);
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(a)}
              y1={cy + r1 * Math.sin(a)}
              x2={cx + r2 * Math.cos(a)}
              y2={cy + r2 * Math.sin(a)}
              stroke={major ? "rgba(155,184,224,0.35)" : "rgba(122,159,212,0.12)"}
              strokeWidth={major ? 1.4 : 0.7}
            />
          );
        })}
        <motion.g
          animate={{ rotate: rotation }}
          transition={
            spinning
              ? { duration: 4.6, ease: [0.12, 0.75, 0.12, 1] }
              : { duration: 0.25 }
          }
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          <circle cx={cx} cy={cy} r={r} fill="url(#wbg)" />
          {slices.map(({ p, path, tx, ty }) => (
            <g key={p.id}>
              <path d={path} fill={p.color} fillOpacity={0.14} stroke={p.color} strokeWidth={1} strokeOpacity={0.55} />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={p.color}
                fontSize={10}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight={600}
                filter="url(#wglow)"
              >
                {p.short}
              </text>
            </g>
          ))}
          <circle cx={cx} cy={cy} r={26} fill="#0a0e16" stroke="rgba(155,184,224,0.25)" strokeWidth={1.5} />
          <text
            x={cx}
            y={cy + 3}
            textAnchor="middle"
            fill="#9bb8e0"
            fontSize={9}
            fontFamily="Syne, sans-serif"
            fontWeight={700}
            letterSpacing="0.12em"
          >
            NEXUS
          </text>
        </motion.g>
      </svg>
      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)]">
        {spinning ? "предвкушение…" : "fortune channel"}
      </p>
    </div>
  );
}

function OddsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center px-4 pb-8 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="panel relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Инструкция</p>
                <h2 className="title-display mt-1 text-[20px]">Колесо удачи</h2>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text-dim)]"
                onClick={onClose}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <p className="label-meta mt-3">
              Бесплатные спины ограничены в сутки. Указатель сверху — сектор под ним после остановки и
              есть награда.
            </p>
            <p className="eyebrow mt-5 mb-2">Призы и шансы</p>
            <div className="overflow-hidden rounded-xl border border-[var(--line)]">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-black/25">
                    <th className="px-3 py-2 font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
                      Приз
                    </th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
                      Шанс
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PRIZES.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--line)] last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                          {p.label}
                        </span>
                      </td>
                      <td className="mono px-3 py-2.5 text-[var(--accent-bright)]">{chancePct(p.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="eyebrow mt-5 mb-2">Где применять</p>
            <ul className="space-y-2.5">
              {PRIZES.filter((p) => !["nothing", "ton_dust", "xp_small"].includes(p.id)).map((p) => (
                <li key={p.id} className="rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2.5">
                  <p className="text-[12px] font-semibold" style={{ color: p.color }}>
                    {p.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-dim)]">{p.use}</p>
                </li>
              ))}
              <li className="rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2.5">
                <p className="text-[12px] font-semibold text-[var(--text)]">TON / XP</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-dim)]">
                  Пыль TON — сразу на баланс. XP — в прогресс уровня.
                </p>
              </li>
            </ul>
            <button type="button" className="btn-primary mt-5 w-full" onClick={onClose}>
              Понятно
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Wheel() {
  const dailySt = useDailyStatus();
  const dailyClaim = useDailyClaimFull();
  const wheelSt = useWheelStatus();
  const spinMut = useWheelSpin();
  const promo = usePromoRedeem();

  const [tab, setTab] = useState<Tab>("wheel");
  const [helpOpen, setHelpOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastSpin, setLastSpin] = useState<SpinOut | null>(null);
  const [lastDaily, setLastDaily] = useState<DailyClaim | null>(null);
  const [code, setCode] = useState("");
  const [lastPromo, setLastPromo] = useState<PromoRedeemOut | null>(null);

  async function onDaily() {
    try {
      const r = await dailyClaim.mutateAsync();
      setLastDaily(r);
    } catch {
      /* */
    }
  }

  async function onSpin() {
    if (spinning) return;
    setLastSpin(null);
    setSpinning(true);
    const startRot = rotation;
    setRotation(startRot + 40);

    let outcome: SpinOut | null = null;
    try {
      outcome = await spinMut.mutateAsync();
    } catch {
      setSpinning(false);
      setRotation(startRot);
      return;
    }

    const idx = prizeIndex(outcome.item_id);
    const extra = 5 + Math.floor(Math.random() * 2);
    setRotation(startRot + extra * 360 + targetOffset(idx));
    await new Promise<void>((r) => setTimeout(r, 4700));
    setLastSpin(outcome);
    setSpinning(false);
  }

  async function onPromo() {
    setLastPromo(null);
    try {
      const r = await promo.mutateAsync(code);
      setLastPromo(r);
      setCode("");
    } catch {
      /* */
    }
  }

  if (dailySt.isLoading || wheelSt.isLoading) {
    return <LoadingPanel label="Загрузка контуров наград…" />;
  }

  const d = dailySt.data;
  const w = wheelSt.data;
  const wonIdx = lastSpin ? prizeIndex(lastSpin.item_id) : -1;
  const won = wonIdx >= 0 ? PRIZES[wonIdx] : null;

  return (
    <div className="space-y-4">
      <ScreenHeader
        eyebrow="Награды"
        title="Контур удачи"
        action={
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line-metal)] bg-black/30 text-[15px] font-semibold text-[var(--accent-bright)]"
            aria-label="Инструкция"
          >
            ?
          </button>
        }
      />

      <div
        className="relative flex gap-1 rounded-xl border border-[var(--line-metal)] p-1"
        style={{ background: "rgba(8,10,16,0.65)" }}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="relative flex-1 rounded-[10px] py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors"
              style={{ color: active ? "#e8edf5" : "var(--text-dim)" }}
            >
              {active && (
                <motion.span
                  layoutId="fortune-tab"
                  className="absolute inset-0 rounded-[10px]"
                  style={{
                    background: `linear-gradient(135deg, ${t.glow}, rgba(18,22,32,0.9) 55%)`,
                    boxShadow: `0 0 20px ${t.glow}, inset 0 1px 0 rgba(255,255,255,0.12)`,
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {tab === "wheel" && (
          <motion.div
            key="wheel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="space-y-4"
          >
            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Prize wheel</p>
                <StatusPill tone={(w?.left_today ?? 0) > 0 ? "live" : "neutral"}>
                  {w?.left_today ?? 0}/{w?.free_spins_per_day ?? 0} спин
                </StatusPill>
              </div>
              <div className="mt-5">
                <FortuneWheel rotation={rotation} spinning={spinning} />
              </div>
              <button
                type="button"
                className="btn-primary mt-5 w-full"
                disabled={spinning || spinMut.isPending || (w?.left_today ?? 0) <= 0}
                onClick={onSpin}
              >
                {spinning
                  ? "Крутится…"
                  : (w?.left_today ?? 0) <= 0
                    ? "Лимит на сегодня"
                    : "Крутить колесо"}
              </button>
              {spinMut.isError && (
                <div className="mt-3">
                  <ErrorPanel
                    message={spinMut.error instanceof Error ? spinMut.error.message : "Ошибка рулетки"}
                  />
                </div>
              )}
              <AnimatePresence mode="wait">
                {lastSpin && !spinning && won && (
                  <motion.div
                    key={lastSpin.item_id + String(lastSpin.free_spins_left_today)}
                    initial={{ opacity: 0, scale: 0.94, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 22 }}
                    className="mt-4 rounded-2xl border p-4"
                    style={{
                      borderColor: `${won.color}44`,
                      background: `linear-gradient(145deg, ${won.color}18, rgba(6,8,14,0.92))`,
                      boxShadow: `0 0 28px ${won.color}33`,
                    }}
                  >
                    <p className="eyebrow" style={{ color: won.color }}>
                      Выпало
                    </p>
                    <p className="mt-1 text-lg font-semibold tracking-tight">{won.label}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[var(--text-dim)]">
                      {Number(lastSpin.reward_ton) > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          +{Number(lastSpin.reward_ton).toFixed(4)} TON
                        </span>
                      )}
                      {lastSpin.reward_xp > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          +{lastSpin.reward_xp} XP
                        </span>
                      )}
                      {lastSpin.reward_focus > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          Фокус +{lastSpin.reward_focus}
                        </span>
                      )}
                      {lastSpin.reward_block > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          Запрет +{lastSpin.reward_block}
                        </span>
                      )}
                      {lastSpin.success_boost_bp > 0 && (
                        <span className="rounded-md border border-[var(--success)]/30 px-2 py-0.5 text-[var(--success)]">
                          +{lastSpin.success_boost_bp / 100}% успех
                        </span>
                      )}
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-[var(--text-dim)]">
                      осталось спинов: {lastSpin.free_spins_left_today}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {tab === "daily" && (
          <motion.div
            key="daily"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <div className="panel space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Check-in</p>
                <StatusPill tone={d?.claimed_today ? "ok" : "neutral"}>
                  streak {d?.streak ?? 0}
                </StatusPill>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Readout label="Серия" value={String(d?.streak ?? 0)} unit="дн" />
                <Readout label="Сегодня" value={d?.claimed_today ? "получено" : "доступно"} />
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={dailyClaim.isPending || !!d?.claimed_today}
                onClick={onDaily}
              >
                <IconSpark size={16} />
                {d?.claimed_today
                  ? "Уже получено"
                  : dailyClaim.isPending
                    ? "Начисление…"
                    : "Забрать daily"}
              </button>
              {dailyClaim.isError && (
                <ErrorPanel
                  message={dailyClaim.error instanceof Error ? dailyClaim.error.message : "Ошибка daily"}
                />
              )}
              <AnimatePresence>
                {lastDaily && !lastDaily.already_claimed && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/5 p-3 text-[13px]"
                  >
                    +{Number(lastDaily.reward_ton).toFixed(4)} TON
                    {lastDaily.reward_xp > 0 && ` · +${lastDaily.reward_xp} XP`}
                    {lastDaily.reward_focus > 0 && ` · Фокус +${lastDaily.reward_focus}`}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {tab === "promo" && (
          <motion.div
            key="promo"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <div className="panel space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Промокод</p>
                <StatusPill tone={promo.isSuccess ? "ok" : "neutral"}>redeem</StatusPill>
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
                Один код — один раз на аккаунт. Награда сразу на баланс / XP / Фокус.
              </p>
              <label className="block text-[11px] font-medium text-[var(--text-dim)]">
                Код
                <input
                  className="input-field mono uppercase tracking-wider"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="NEXUS-START"
                  disabled={promo.isPending}
                  autoCapitalize="characters"
                  autoCorrect="off"
                />
              </label>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={promo.isPending || code.trim().length < 3}
                onClick={onPromo}
              >
                {promo.isPending ? "Проверка…" : "Активировать"}
              </button>
              {promo.isError && (
                <ErrorPanel
                  message={promo.error instanceof Error ? promo.error.message : "Код не принят"}
                />
              )}
              <AnimatePresence>
                {lastPromo && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/5 p-4"
                  >
                    <p className="eyebrow text-[var(--success)]">Активирован</p>
                    <p className="mono mt-1 text-sm font-semibold">{lastPromo.code}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[var(--text-dim)]">
                      {Number(lastPromo.reward_ton) > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          +{Number(lastPromo.reward_ton).toFixed(4)} TON
                        </span>
                      )}
                      {lastPromo.reward_xp > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          +{lastPromo.reward_xp} XP
                        </span>
                      )}
                      {lastPromo.reward_focus > 0 && (
                        <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                          Фокус +{lastPromo.reward_focus}
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <OddsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <style>{`
        @keyframes wheel-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
