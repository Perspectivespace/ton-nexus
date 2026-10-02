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

/** Mirror of default economy prize_wheel items (visual only until API exposes table). */
const PRIZES = [
  { id: "success_plus_5", label: "+5% успех", short: "+5%", color: "#3dd68c", glow: "rgba(61,214,140,0.55)" },
  { id: "focus_1", label: "Фокус ×1", short: "Фокус", color: "#6b9bff", glow: "rgba(107,155,255,0.55)" },
  { id: "block_1", label: "Запрет ×1", short: "Запрет", color: "#8b7cf7", glow: "rgba(139,124,247,0.55)" },
  { id: "xp_small", label: "XP", short: "XP", color: "#f5c14a", glow: "rgba(245,193,74,0.5)" },
  { id: "ton_dust", label: "Пыль TON", short: "TON", color: "#5ce1ff", glow: "rgba(92,225,255,0.55)" },
  { id: "nothing", label: "Пусто", short: "—", color: "#4a5568", glow: "rgba(74,85,104,0.4)" },
] as const;

const SEG = 360 / PRIZES.length;

function prizeIndex(itemId: string): number {
  const i = PRIZES.findIndex((p) => p.id === itemId);
  return i >= 0 ? i : PRIZES.length - 1;
}

function targetOffset(index: number): number {
  const center = index * SEG + SEG / 2;
  return 360 - center;
}

function CyberWheel({
  rotation,
  spinning,
}: {
  rotation: number;
  spinning: boolean;
}) {
  const r = 110;
  const cx = 120;
  const cy = 120;

  const slices = useMemo(() => {
    return PRIZES.map((p, i) => {
      const a0 = ((i * SEG - 90) * Math.PI) / 180;
      const a1 = (((i + 1) * SEG - 90) * Math.PI) / 180;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const large = SEG > 180 ? 1 : 0;
      const path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
      const mid = ((i * SEG + SEG / 2 - 90) * Math.PI) / 180;
      const tx = cx + r * 0.62 * Math.cos(mid);
      const ty = cy + r * 0.62 * Math.sin(mid);
      return { p, path, tx, ty };
    });
  }, []);

  return (
    <div className="relative mx-auto w-[min(100%,280px)]">
      <div
        className="pointer-events-none absolute -inset-3 rounded-full opacity-80"
        style={{
          background: spinning
            ? "conic-gradient(from 0deg, #5ce1ff, #8b7cf7, #ff2d95, #5ce1ff)"
            : "conic-gradient(from 0deg, rgba(92,225,255,0.35), rgba(139,124,247,0.25), rgba(255,45,149,0.2), rgba(92,225,255,0.35))",
          filter: spinning ? "blur(8px)" : "blur(12px)",
          animation: spinning ? "wheel-aura 1.2s linear infinite" : undefined,
        }}
      />

      <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1">
        <div
          className="h-0 w-0 border-l-[10px] border-r-[10px] border-t-[18px] border-l-transparent border-r-transparent"
          style={{
            borderTopColor: "#5ce1ff",
            filter: "drop-shadow(0 0 8px rgba(92,225,255,0.9))",
          }}
        />
      </div>

      <motion.div
        className="relative aspect-square w-full"
        animate={{ rotate: rotation }}
        transition={
          spinning
            ? { duration: 4.2, ease: [0.12, 0.8, 0.15, 1] }
            : { duration: 0.35 }
        }
      >
        <svg viewBox="0 0 240 240" className="h-full w-full">
          <defs>
            <filter id="neon">
              <feGaussianBlur stdDeviation="1.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={cx} cy={cy} r={r + 4} fill="#0a0e18" stroke="rgba(92,225,255,0.35)" strokeWidth="2" />
          {slices.map(({ p, path, tx, ty }) => (
            <g key={p.id}>
              <path
                d={path}
                fill={p.color}
                fillOpacity={0.22}
                stroke={p.color}
                strokeWidth="1.2"
                strokeOpacity={0.85}
              />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={p.color}
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
                filter="url(#neon)"
              >
                {p.short}
              </text>
            </g>
          ))}
          <circle cx={cx} cy={cy} r={28} fill="#06080e" stroke="#5ce1ff" strokeWidth="2" />
          <circle
            cx={cx}
            cy={cy}
            r={18}
            fill="rgba(92,225,255,0.12)"
            stroke="rgba(255,45,149,0.5)"
            strokeWidth="1"
          />
        </svg>
      </motion.div>

      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)]">
        {spinning ? "сканирование сектора…" : "nexus roulette"}
      </p>
    </div>
  );
}

export function Wheel() {
  const dailySt = useDailyStatus();
  const dailyClaim = useDailyClaimFull();
  const wheelSt = useWheelStatus();
  const spinMut = useWheelSpin();
  const promo = usePromoRedeem();

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

    const extraSpins = 5 + Math.floor(Math.random() * 3);
    let result: SpinOut | null = null;

    const apiPromise = spinMut
      .mutateAsync()
      .then((r) => {
        result = r;
      })
      .catch(() => {
        result = null;
      });

    // Kick off long rotation; final index applied after API returns
    const startRot = rotation;
    const placeholderIdx = Math.floor(Math.random() * PRIZES.length);
    setRotation(startRot + extraSpins * 360 + targetOffset(placeholderIdx));

    await Promise.all([apiPromise, new Promise((r) => setTimeout(r, 4200))]);

    if (!result) {
      setSpinning(false);
      return;
    }

    const idx = prizeIndex(result.item_id);
    const finalRot = startRot + extraSpins * 360 + targetOffset(idx);
    setRotation(finalRot);

    await new Promise((r) => setTimeout(r, 450));
    setLastSpin(result);
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
  const won = lastSpin ? PRIZES[prizeIndex(lastSpin.item_id)] : null;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Награды"
        title="Контур удачи"
        action={
          <StatusPill tone={d?.claimed_today ? "ok" : "live"}>
            {d?.claimed_today ? "daily ✓" : "daily open"}
          </StatusPill>
        }
      />

      <div className="panel relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40"
          style={{
            background: "radial-gradient(circle, rgba(255,45,149,0.25), transparent 70%)",
          }}
        />
        <div className="relative flex items-center justify-between">
          <p className="eyebrow text-[#5ce1ff]">Prize wheel</p>
          <StatusPill tone={(w?.left_today ?? 0) > 0 ? "live" : "neutral"}>
            {w?.left_today ?? 0}/{w?.free_spins_per_day ?? 0} спин
          </StatusPill>
        </div>

        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-dim)]">
          Секторы на диске и в легенде — возможные дропы. Указатель сверху; после остановки сектор
          под ним — награда.
        </p>

        <div className="mt-5">
          <CyberWheel rotation={rotation} spinning={spinning} />
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRIZES.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: p.color, boxShadow: `0 0 8px ${p.glow}` }}
              />
              <span className="truncate text-[11px] text-[var(--text-dim)]">{p.label}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn-primary mt-5 w-full"
          style={{
            background: spinning
              ? "linear-gradient(135deg, #3a4a6a, #2a3550)"
              : "linear-gradient(135deg, #5ce1ff 0%, #8b7cf7 50%, #ff2d95 100%)",
            boxShadow: spinning ? "none" : "0 0 28px rgba(92,225,255,0.35)",
          }}
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
          {lastSpin && !spinning && (
            <motion.div
              key={lastSpin.item_id + lastSpin.label}
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="mt-4 overflow-hidden rounded-2xl border p-4"
              style={{
                borderColor: won ? `${won.color}55` : "var(--line)",
                background: won
                  ? `linear-gradient(145deg, ${won.glow.replace("0.55", "0.12").replace("0.5", "0.12").replace("0.4", "0.1")}, rgba(6,8,14,0.9))`
                  : "var(--bg-panel)",
                boxShadow: won ? `0 0 32px ${won.glow}` : undefined,
              }}
            >
              <p className="eyebrow" style={{ color: won?.color }}>
                Выпало
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{lastSpin.label}</p>
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

      <div className="panel panel-glow space-y-4 p-5">
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
            message={
              dailyClaim.error instanceof Error ? dailyClaim.error.message : "Ошибка daily"
            }
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

      <div className="panel panel-glow space-y-4 p-5">
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

      <style>{`
        @keyframes wheel-aura {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
