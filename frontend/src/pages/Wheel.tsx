import { useState } from "react";
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
    color: "#7ecfb5",
    kind: "spin" as const,
    use: "Добавляет +5% к шансу успеха следующей попытки усиления майнера. Не гарантирует успех.",
  },
  {
    id: "focus_1",
    label: "Фокус ×1",
    short: "Фокус",
    weight: 15,
    color: "#b0c8ec",
    kind: "prize" as const,
    use: "Повышает вес нужного типа на колесе апгрейда (чаще выпадает выбранный стат).",
  },
  {
    id: "block_1",
    label: "Запрет ×1",
    short: "Запрет",
    weight: 12,
    color: "#c0b6ee",
    kind: "prize" as const,
    use: "Блокирует выпадение одного нежелательного типа апгрейда.",
  },
  {
    id: "xp_small",
    label: "XP",
    short: "XP",
    weight: 25,
    color: "#b0c8ec",
    kind: "xp" as const,
    use: "Опыт уровня аккаунта.",
  },
  {
    id: "ton_dust",
    label: "Пыль TON",
    short: "TON",
    weight: 20,
    color: "#d8e0ec",
    kind: "prize" as const,
    use: "Небольшая сумма TON на баланс.",
  },
  {
    id: "nothing",
    label: "Пусто",
    short: "МИСС",
    weight: 20,
    color: "#d49292",
    kind: "miss" as const,
    use: "Пустой сектор — без награды.",
  },
] as const;

const WEIGHT_SUM = PRIZES.reduce((s, p) => s + p.weight, 0);
const SEG = 360 / PRIZES.length;

const WHEEL_SIZE = 240;
const WHEEL_SVG = WHEEL_SIZE + 20;
const WHEEL_RADIUS = WHEEL_SIZE / 2 - 4;
const TEXT_RADIUS = WHEEL_RADIUS - 22;

type Tab = "wheel" | "daily" | "promo";

function prizeIndex(itemId: string): number {
  const i = PRIZES.findIndex((p) => p.id === itemId);
  return i >= 0 ? i : PRIZES.length - 1;
}

function targetOffset(index: number): number {
  return 360 - index * SEG;
}

function chancePct(weight: number): string {
  return `${((weight / WEIGHT_SUM) * 100).toFixed(0)}%`;
}

function segmentFill(kind: (typeof PRIZES)[number]["kind"]): string {
  if (kind === "miss") return "url(#segmentMiss)";
  if (kind === "spin") return "url(#segmentSpin)";
  if (kind === "xp") return "url(#segmentXp)";
  return "url(#segmentPrize)";
}

function segmentStroke(kind: (typeof PRIZES)[number]["kind"]): string {
  if (kind === "miss") return "rgba(230,165,188,0.58)";
  if (kind === "spin") return "rgba(125,225,200,0.58)";
  if (kind === "xp") return "rgba(180,205,240,0.6)";
  return "rgba(150,185,235,0.58)";
}

function FortuneWheel({ rotation, spinning }: { rotation: number; spinning: boolean }) {
  const cx = WHEEL_SVG / 2;
  const cy = WHEEL_SVG / 2;

  return (
    <div className="relative mb-2" style={{ width: WHEEL_SVG, height: WHEEL_SVG }}>
      <div className={`wheel-aura absolute inset-0 rounded-full${spinning ? " spinning" : ""}`} aria-hidden />

      <svg width={WHEEL_SVG} height={WHEEL_SVG} viewBox={`0 0 ${WHEEL_SVG} ${WHEEL_SVG}`} className="relative z-10">
        <defs>
          <radialGradient id="wheelBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#141e32" />
            <stop offset="70%" stopColor="#0e1626" />
            <stop offset="100%" stopColor="#0a101c" />
          </radialGradient>
          <radialGradient id="wheelCenterGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a2236" />
            <stop offset="60%" stopColor="#0e1422" />
            <stop offset="100%" stopColor="#080c14" />
          </radialGradient>
          <linearGradient id="rimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(155,184,224,0.3)" />
            <stop offset="50%" stopColor="rgba(122,159,212,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.4)" />
          </linearGradient>
          <linearGradient id="segmentPrize" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3d5a8c" />
            <stop offset="40%" stopColor="#2a4570" />
            <stop offset="100%" stopColor="#1a3254" />
          </linearGradient>
          <linearGradient id="segmentMiss" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#524058" />
            <stop offset="45%" stopColor="#3a3046" />
            <stop offset="100%" stopColor="#261e32" />
          </linearGradient>
          <linearGradient id="segmentSpin" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#356864" />
            <stop offset="45%" stopColor="#254e4c" />
            <stop offset="100%" stopColor="#183836" />
          </linearGradient>
          <linearGradient id="segmentXp" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#456288" />
            <stop offset="45%" stopColor="#304a6e" />
            <stop offset="100%" stopColor="#1e3450" />
          </linearGradient>
          <radialGradient id="segSheen" cx="32%" cy="28%" r="72%">
            <stop offset="0%" stopColor="rgba(230,240,255,0.26)" />
            <stop offset="50%" stopColor="rgba(155,184,224,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <linearGradient id="nexusTextGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#dce9ff" />
            <stop offset="50%" stopColor="#9bb8e0" />
            <stop offset="100%" stopColor="#6681ae" />
          </linearGradient>
          <filter id="segmentGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" result="soft" />
            <feMerge>
              <feMergeNode in="soft" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="wheelGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r={WHEEL_RADIUS + 8} fill="none" stroke="url(#rimGrad)" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={WHEEL_RADIUS + 8} fill="none" stroke="rgba(155,184,224,0.15)" strokeWidth={1} />

        {Array.from({ length: 48 }).map((_, i) => {
          const angle = (i / 48) * 2 * Math.PI - Math.PI / 2;
          const r1 = WHEEL_RADIUS + 4;
          const r2 = WHEEL_RADIUS + 7;
          const isMajor = i % 6 === 0;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(angle)}
              y1={cy + r1 * Math.sin(angle)}
              x2={cx + r2 * Math.cos(angle)}
              y2={cy + r2 * Math.sin(angle)}
              stroke={isMajor ? "rgba(155,184,224,0.4)" : "rgba(122,159,212,0.12)"}
              strokeWidth={isMajor ? 1.5 : 0.8}
            />
          );
        })}

        <motion.g
          animate={{ rotate: rotation }}
          transition={
            spinning
              ? { duration: 4.8, ease: [0.17, 0.67, 0.12, 0.99] }
              : { duration: 0 }
          }
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transformBox: "view-box",
          }}
        >
          <circle cx={cx} cy={cy} r={WHEEL_RADIUS} fill="url(#wheelBg)" />

          {PRIZES.map((seg, i) => {
            const startAngle = ((i * SEG - 90 - SEG / 2) * Math.PI) / 180;
            const endAngle = ((i * SEG - 90 + SEG / 2) * Math.PI) / 180;
            const mid = ((i * SEG - 90) * Math.PI) / 180;
            const x1 = cx + WHEEL_RADIUS * Math.cos(startAngle);
            const y1 = cy + WHEEL_RADIUS * Math.sin(startAngle);
            const x2 = cx + WHEEL_RADIUS * Math.cos(endAngle);
            const y2 = cy + WHEEL_RADIUS * Math.sin(endAngle);
            const path = `M ${cx} ${cy} L ${x1} ${y1} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${x2} ${y2} Z`;
            const rOuter = WHEEL_RADIUS - 6;
            const rMid = WHEEL_RADIUS * 0.58;
            return (
              <g key={seg.id}>
                <path
                  d={path}
                  fill={segmentFill(seg.kind)}
                  stroke={segmentStroke(seg.kind)}
                  strokeWidth={1.45}
                  strokeLinejoin="round"
                  filter="url(#segmentGlow)"
                />
                <path d={path} fill="url(#segSheen)" opacity={0.9} />
                <path
                  d={`M ${cx + rOuter * Math.cos(startAngle)} ${cy + rOuter * Math.sin(startAngle)} A ${rOuter} ${rOuter} 0 0 1 ${cx + rOuter * Math.cos(endAngle)} ${cy + rOuter * Math.sin(endAngle)}`}
                  fill="none"
                  stroke="rgba(235,245,255,0.32)"
                  strokeWidth={1.25}
                />
                <path
                  d={`M ${cx + rMid * Math.cos(startAngle)} ${cy + rMid * Math.sin(startAngle)} A ${rMid} ${rMid} 0 0 1 ${cx + rMid * Math.cos(endAngle)} ${cy + rMid * Math.sin(endAngle)}`}
                  fill="none"
                  stroke={seg.color}
                  strokeOpacity={0.28}
                  strokeWidth={1.05}
                />
                <circle
                  cx={cx + WHEEL_RADIUS * 0.78 * Math.cos(mid)}
                  cy={cy + WHEEL_RADIUS * 0.78 * Math.sin(mid)}
                  r={2.4}
                  fill={seg.color}
                  fillOpacity={0.4}
                />
              </g>
            );
          })}

          {PRIZES.map((seg, i) => {
            const angle = i * SEG;
            return (
              <g key={`t-${seg.id}`} transform={`rotate(${angle} ${cx} ${cy})`}>
                <text
                  x={cx}
                  y={cy - TEXT_RADIUS + 6}
                  textAnchor="middle"
                  fill={seg.color}
                  fontSize={11}
                  fontFamily="'IBM Plex Mono', monospace"
                  fontWeight={600}
                  style={{ letterSpacing: "0.02em" }}
                  filter="url(#wheelGlow)"
                >
                  {seg.short}
                </text>
              </g>
            );
          })}

          <circle cx={cx} cy={cy} r={WHEEL_RADIUS * 0.45} fill="none" stroke="rgba(122,159,212,0.08)" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={WHEEL_RADIUS * 0.42} fill="none" stroke="rgba(155,184,224,0.04)" strokeWidth={0.5} />

          <circle cx={cx} cy={cy} r={22} fill="url(#wheelCenterGrad)" stroke="rgba(155,184,224,0.2)" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={18} fill="none" stroke="rgba(122,159,212,0.08)" strokeWidth={0.5} />
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fill="url(#nexusTextGrad)"
            fontSize={10}
            fontFamily="Syne, sans-serif"
            fontWeight={700}
            letterSpacing="0.1em"
          >
            NEXUS
          </text>

          {[0, 90, 180, 270].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <circle
                key={a}
                cx={cx + 15 * Math.cos(rad)}
                cy={cy + 15 * Math.sin(rad)}
                r={1.5}
                fill="rgba(155,184,224,0.25)"
              />
            );
          })}
        </motion.g>

        <g transform={`translate(${cx}, 10)`}>
          <path d="M 0 0 L -7 -6 L 7 -6 Z" fill="#9bb8e0" filter="url(#wheelGlow)" />
          <path d="M 0 0 L -5 -4 L 5 -4 Z" fill="rgba(155,184,224,0.5)" />
          <circle cx={0} cy={-2} r={2} fill="#9bb8e0" />
        </g>
      </svg>
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
          <div className="absolute inset-0 bg-[var(--bg)]/90" />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="metal-plate-hero relative z-10 max-h-[80vh] w-full max-w-[350px] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Flight Manual</p>
                <h2 className="title-display mt-1 text-[20px]">Колесо удачи</h2>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg metal-plate-dim text-[var(--text-dim)]"
                onClick={onClose}
              >
                ×
              </button>
            </div>
            <p className="label-meta mt-3">
              Указатель сверху. После остановки сектор под ним — ваша награда.
            </p>
            <p className="eyebrow mt-5 mb-2">Призы и шансы</p>
            <div className="overflow-hidden rounded-xl border border-[rgba(122,159,212,0.12)]">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[rgba(122,159,212,0.1)] bg-black/25">
                    <th className="px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-[var(--text-dim)]">Приз</th>
                    <th className="px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-[var(--text-dim)]">Шанс</th>
                  </tr>
                </thead>
                <tbody>
                  {PRIZES.map((p) => (
                    <tr key={p.id} className="border-b border-[rgba(122,159,212,0.06)] last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color, opacity: 0.8 }} />
                          {p.label}
                        </span>
                      </td>
                      <td className="mono px-3 py-2.5 text-[#9bb8e0]">{chancePct(p.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="eyebrow mt-5 mb-2">Где применять</p>
            <ul className="space-y-2">
              {PRIZES.filter((p) => !["nothing", "ton_dust", "xp_small"].includes(p.id)).map((p) => (
                <li key={p.id} className="rounded-xl border border-[rgba(122,159,212,0.1)] bg-black/25 px-3 py-2.5">
                  <p className="text-[12px] font-semibold" style={{ color: p.color }}>
                    {p.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-dim)]">{p.use}</p>
                </li>
              ))}
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
      setLastDaily(await dailyClaim.mutateAsync());
    } catch {
      /* */
    }
  }

  async function onSpin() {
    if (spinning) return;
    setLastSpin(null);
    setSpinning(true);
    const startRot = rotation;

    let outcome: SpinOut | null = null;
    try {
      outcome = await spinMut.mutateAsync();
    } catch {
      setSpinning(false);
      return;
    }

    const idx = prizeIndex(outcome.item_id);
    setRotation(startRot + 360 * 6 + targetOffset(idx));
    await new Promise<void>((r) => setTimeout(r, 4800));
    setLastSpin(outcome);
    setSpinning(false);
  }

  async function onPromo() {
    setLastPromo(null);
    try {
      setLastPromo(await promo.mutateAsync(code));
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
  const left = w?.left_today ?? 0;
  const maxSpins = w?.free_spins_per_day ?? 1;
  const won = lastSpin ? PRIZES[prizeIndex(lastSpin.item_id)] : null;

  return (
    <div className="space-y-4">
      <ScreenHeader
        eyebrow="Модуль 02 · Удача"
        title="Колесо удачи"
        action={
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full metal-plate-dim text-[14px] font-semibold text-[#9bb8e0]"
            aria-label="Инструкция"
          >
            ?
          </button>
        }
      />

      <div className="metal-plate-dim fortune-tabs">
        {(
          [
            { key: "wheel" as const, label: "Колесо" },
            { key: "daily" as const, label: "Чекин" },
            { key: "promo" as const, label: "Промо" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`fortune-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "wheel" && (
          <motion.div
            key="wheel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center"
          >
            <div className="mb-5 flex items-center gap-3 rounded-full metal-plate-dim px-4 py-2">
              <span className="eyebrow">Free Spins</span>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.max(maxSpins, 1) }).map((_, i) => (
                  <div
                    key={i}
                    className="h-1.5 w-1.5 rounded-full transition-colors"
                    style={{
                      background: i < left ? "#9bb8e0" : "rgba(122,159,212,0.15)",
                      boxShadow: i < left ? "0 0 6px rgba(155,184,224,0.6)" : undefined,
                    }}
                  />
                ))}
              </div>
              <span className="mono text-[14px] font-semibold text-[#9bb8e0]">{left}</span>
            </div>

            <FortuneWheel rotation={rotation} spinning={spinning} />

            <div className="mb-4 flex h-10 items-center justify-center">
              {spinning && (
                <span className="subtle-glow text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-dim)]">
                  Вращение…
                </span>
              )}
              {lastSpin && !spinning && won && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.85, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="rounded-full metal-plate-hero px-4 py-2"
                >
                  <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#9bb8e0]">
                    Вы выиграли: {won.label}
                  </span>
                </motion.div>
              )}
            </div>

            <div className="metal-plate-dim mb-4 w-full p-3">
              <p className="eyebrow mb-2">Prize Legend</p>
              <div className="grid grid-cols-3 gap-2">
                {PRIZES.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5">
                    <div
                      className="h-2 w-2 shrink-0 rounded-[2px]"
                      style={{ background: p.color, opacity: 0.75 }}
                    />
                    <span className="truncate font-mono text-[8px] text-[var(--text-dim)]">{p.short}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn-primary w-full"
              disabled={spinning || spinMut.isPending || left <= 0}
              onClick={onSpin}
            >
              {spinning ? "Вращение…" : left <= 0 ? "Нет свободных спинов" : "Крутить колесо"}
            </button>

            {spinMut.isError && (
              <div className="mt-3 w-full">
                <ErrorPanel
                  message={spinMut.error instanceof Error ? spinMut.error.message : "Ошибка рулетки"}
                />
              </div>
            )}

            {lastSpin && !spinning && (
              <div className="mt-3 flex flex-wrap justify-center gap-2 text-[11px] text-[var(--text-dim)]">
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
            )}
          </motion.div>
        )}

        {tab === "daily" && (
          <motion.div
            key="daily"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="metal-plate-hero space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Ежедневная отметка</p>
                <StatusPill tone={d?.claimed_today ? "ok" : "neutral"}>
                  серия {d?.streak ?? 0}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="metal-plate-hero space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Промокод</p>
                <StatusPill tone={promo.isSuccess ? "ok" : "neutral"}>промокод</StatusPill>
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
                Один код — один раз на аккаунт.
              </p>
              <label className="block text-[11px] font-medium text-[var(--text-dim)]">
                Код
                <input
                  className="input-field mono uppercase tracking-wider"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="NEXUS-START"
                  disabled={promo.isPending}
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <OddsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
