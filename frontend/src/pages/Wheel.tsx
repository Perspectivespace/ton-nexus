import { useRef, useState } from "react";
import {
  useWheelStatus,
  useWheelSpin,
  type SpinOut,
} from "@/api/hooks";
import {
  ScreenHeader,
  LoadingPanel,
  Readout,
  Panel,
  Scrim,
  Tag,
  Button,
  Sheet,
  PrizeWheel,
  useToast,
  cx,
  type PrizeWheelHandle,
  type WheelRole,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { IconBolt, IconSpark } from "@/components/icons";
import { useScreenBack } from "@/lib/backButton";
import { useDaily } from "@/lib/useDaily";
import { formatLeft, nextMskMidnight, useCountdown } from "@/lib/countdown";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Сектора колеса. Порядок — визуальный (цвета чередуются), выпавший сектор ищется по id ответа сервера.
 * Шансы не зашиты: приходят с сервера в /wheel/status (веса из настроек владельца).
 */
const PRIZES: readonly {
  id: string;
  title: string;
  sub?: string;
  label: string;
  role: WheelRole;
  use: string;
}[] = [
  { id: "success_plus_5", title: "+5%", sub: "успех", label: "+5% к успеху", role: "hot", use: "Добавляет +5% к шансу успеха следующей попытки усиления майнера. Не гарантирует успех." },
  { id: "xp_small", title: "XP", sub: "опыт", label: "XP", role: "steel", use: "Опыт уровня аккаунта." },
  { id: "focus_1", title: "Фокус", sub: "×1", label: "Фокус ×1", role: "amber", use: "Повышает вес нужного типа на колесе апгрейда (чаще выпадает выбранный стат)." },
  { id: "nothing", title: "Пусто", label: "Пусто", role: "void", use: "Пустой сектор — без награды." },
  { id: "ton_dust", title: "TON", sub: "пыль", label: "Пыль TON", role: "neon", use: "Небольшая сумма TON на баланс." },
  { id: "block_1", title: "Запрет", sub: "×1", label: "Запрет ×1", role: "magenta", use: "Блокирует выпадение одного нежелательного типа апгрейда." },
];
const MISS = PRIZES.findIndex((p) => p.id === "nothing");

function prizeIndex(itemId: string): number {
  const i = PRIZES.findIndex((p) => p.id === itemId);
  return i >= 0 ? i : MISS;
}

function rewardParts(r: SpinOut): string[] {
  return [
    Number(r.reward_ton) > 0 && `+${Number(r.reward_ton).toFixed(4)} TON`,
    r.reward_xp > 0 && `+${r.reward_xp} XP`,
    r.reward_focus > 0 && `Фокус +${r.reward_focus}`,
    r.reward_block > 0 && `Запрет +${r.reward_block}`,
    r.success_boost_bp > 0 && `+${r.success_boost_bp / 100}% к успеху`,
  ].filter(Boolean) as string[];
}

const DOT: Record<WheelRole, string> = {
  hot: "var(--amber-core)",
  amber: "var(--amber)",
  neon: "var(--neon)",
  magenta: "var(--magenta)",
  steel: "var(--text-2)",
  void: "var(--line-strong)",
};

const pct = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

type Phase = "idle" | "wait" | "spin" | "done";

export function Wheel() {
  useScreenBack("/");
  const daily = useDaily();
  const wheelSt = useWheelStatus();
  const qc = useQueryClient();
  const resetAt = wheelSt.data && wheelSt.data.left_today <= 0 ? (wheelSt.data.next_reset_at ? Date.parse(wheelSt.data.next_reset_at) : nextMskMidnight()) : null;
  const spinLeftMs = useCountdown(resetAt, 0, () => qc.invalidateQueries({ queryKey: ["wheel"] }));
  const spinIn = spinLeftMs != null ? formatLeft(spinLeftMs) : null;
  const spinMut = useWheelSpin();
  const toast = useToast();

  const wheel = useRef<PrizeWheelHandle>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [win, setWin] = useState<number | null>(null);
  const [last, setLast] = useState<SpinOut | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const busy = phase === "wait" || phase === "spin";

  async function onSpin() {
    if (busy) return;
    setWin(null);
    setLast(null);
    setPhase("wait");
    let out: SpinOut;
    try {
      // сначала ответ сервера, потом колесо доезжает до выпавшего сектора
      out = await spinMut.mutateAsync();
    } catch (e) {
      setPhase("idle");
      toast({ kind: "danger", title: "Колесо не ответило", sub: e instanceof Error ? e.message : undefined });
      return;
    }
    const idx = prizeIndex(out.item_id);
    setPhase("spin");
    await wheel.current?.spinTo(idx);
    setWin(idx);
    setLast(out);
    setPhase("done");
    const p = PRIZES[idx];
    if (p.id === "nothing" && rewardParts(out).length === 0) {
      toast({ kind: "info", title: "Пустой сектор", sub: "в этот раз без награды" });
    } else {
      haptic.heavy();
      toast({ kind: "amber", title: `Выигрыш: ${out.label || p.label}`, sub: rewardParts(out).join(" · ") || undefined });
    }
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  if (daily.loading || wheelSt.isLoading) {
    return <LoadingPanel label="Загрузка колеса…" />;
  }

  const d = daily.status;
  const w = wheelSt.data;
  const left = w?.left_today ?? 0;
  const maxSpins = Math.max(w?.free_spins_per_day ?? 1, 1);
  const won = win != null ? PRIZES[win] : null;
  const miss = !!last && won?.id === "nothing" && rewardParts(last).length === 0;
  const spinsOut = left <= 0;
  const odds = w?.sectors ? new Map(w.sectors.map((s) => [s.id, s])) : null;

  return (
    <div
      className="space-y-5"
      onPointerDown={() => {
        if (phase === "spin") wheel.current?.skip();
      }}
    >
      <ScreenHeader
        eyebrow="Удача"
        title="Колесо удачи"
        action={
          <Button kind="secondary" size="sm" onClick={() => setHelpOpen(true)} aria-label="Призы и шансы">
            Шансы
          </Button>
        }
      />

      {/* Герой: колесо (п. 8.3) */}
      <Panel level="hero" cut="l" lift="l2" className="px-5 pb-0 pt-5">
        <p className="sr-only">
          Бесплатных вращений сегодня: {left} из {maxSpins}
        </p>
        <PrizeWheel
          ref={wheel}
          sectors={PRIZES}
          winIndex={phase === "done" ? win : null}
          spinning={phase === "spin"}
          miss={miss}
          spins={{ left, max: maxSpins }}
          mode={phase === "wait" ? "Связь" : phase === "spin" ? "Вращение" : phase === "done" ? (miss ? "Пусто" : "Выигрыш") : left > 0 ? "Готов" : "Ждёт"}
          className="mb-5"
        />
        <Scrim className="relative -mx-5 space-y-3 px-5 pb-5 pt-3">
          <p className="ui-sec text-center !text-[12px]">
            {phase === "wait"
              ? "Связь с колесом…"
              : phase === "spin"
                ? "Тап по экрану — сразу к результату"
                : left > 0
                  ? "Сектор под указателем — ваша награда"
                  : "Бесплатные вращения обновляются в 00:00 мск"}
          </p>
          <span className="ui-spill block">
            <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy || spinsOut} onClick={onSpin}>
              {phase === "wait" ? "Связь…" : phase === "spin" ? "Вращение…" : spinsOut ? (
                <>
                  Следующее через <span className="ui-num">{spinIn ?? "—"}</span>
                </>
              ) : (
                "Крутить колесо"
              )}
            </Button>
          </span>
        </Scrim>
      </Panel>

      {/* Итог вращения: натриевая плашка (награда) или нейтральная (пусто) */}
      {last && won && phase === "done" && (
        <div ref={resultRef} className="scroll-mb-28">
          <Panel className={cx("space-y-3 p-5", !miss && "win-edge")}>
            <div className="flex items-center justify-between gap-3">
              <p className="ui-label">{miss ? "Результат" : "Выигрыш"}</p>
              {miss ? <Tag tone="neutral">пусто</Tag> : <span className="ui-verdict ok ui-ignite">{last.label || won.label}</span>}
            </div>
            {miss ? (
              <p className="ui-sec">Сектор без награды. Повезёт в следующий раз.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {rewardParts(last).map((t) => (
                    <span key={t} className="ui-num text-[20px] font-bold leading-7 text-[var(--amber)]">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="ui-sec !text-[12px] !leading-[16px]">{won.use}</p>
              </>
            )}
          </Panel>
        </div>
      )}

      {/* Ежедневная отметка */}
      <Panel className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-h">Ежедневная отметка</p>
            <p className="ui-sec !text-[12px]">TON, опыт и фокус — раз в день, обновление в 00:00 мск</p>
          </div>
          <Tag tone={daily.waiting ? "ok" : "amber"}>{daily.waiting ? "получено" : "доступно"}</Tag>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Readout label="Серия" value={String(d?.streak ?? 0)} unit="дн" />
          <Readout label={daily.waiting ? "Следующая через" : "Сегодня"} value={daily.countdown ?? "доступно"} />
        </div>
        <Button kind="secondary" block icon={<IconBolt size={18} />} disabled={!daily.ready} onClick={daily.claimNow}>
          {daily.pending ? "Начисление…" : daily.waiting ? "Отметка получена" : "Забрать отметку"}
        </Button>
      </Panel>

      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Призы и шансы">
        <p className="ui-sec !text-[13px]">Указатель сверху. После остановки сектор под ним — ваша награда.</p>
        <p className="ui-sec mt-1 !text-[12px] !leading-[16px]">
          {!odds
            ? "Шансы покажем после обновления сервера."
            : w?.weights_source === "default"
              ? "Сейчас действуют шансы по умолчанию."
              : "Шансы заданы в настройках игры и пересчитываются сразу после их изменения."}
        </p>
        <div className="mt-4 divide-y divide-[var(--line)]">
          {PRIZES.map((p) => {
            const o = odds?.get(p.id);
            const off = !!odds && (!o || o.chance_pct <= 0);
            return (
              <div key={p.id} className={cx("flex gap-3 py-3", off && "opacity-60")}>
                <span className="pw-dot mt-[5px]" style={{ background: DOT[p.role] }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium leading-5 text-[var(--text)]">{o?.label || p.label}</span>
                    {off ? (
                      <Tag tone="neutral">не выпадает</Tag>
                    ) : (
                      <span className="ui-num text-[15px]">{o ? `${pct.format(o.chance_pct)}%` : "—"}</span>
                    )}
                  </div>
                  <p className="ui-sec mt-0.5 !text-[12px] !leading-[16px]">{p.use}</p>
                </div>
              </div>
            );
          })}
        </div>
        <Button kind="primary" block className="mt-4" onClick={() => setHelpOpen(false)}>
          Понятно
        </Button>
      </Sheet>
    </div>
  );
}
