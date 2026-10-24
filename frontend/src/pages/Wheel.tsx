import { useRef, useState } from "react";
import {
  useDailyStatus,
  useDailyClaimFull,
  useWheelStatus,
  useWheelSpin,
  usePromoRedeem,
  type SpinOut,
} from "@/api/hooks";
import {
  ScreenHeader,
  LoadingPanel,
  ErrorPanel,
  Readout,
  Panel,
  Scrim,
  Num,
  Tag,
  Button,
  Field,
  Sheet,
  PrizeWheel,
  useToast,
  cx,
  type PrizeWheelHandle,
  type WheelRole,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { IconBolt, IconSpark } from "@/components/icons";

/**
 * Сектора колеса. Порядок — визуальный (цвета чередуются), выпавший сектор ищется по id ответа сервера.
 * Вес — только для подсказки «Призы и шансы» (как и раньше; сервер крутит по своей конфигурации).
 */
const PRIZES: readonly {
  id: string;
  title: string;
  sub?: string;
  label: string;
  weight: number;
  role: WheelRole;
  use: string;
}[] = [
  { id: "success_plus_5", title: "+5%", sub: "успех", label: "+5% к успеху", weight: 8, role: "hot", use: "Добавляет +5% к шансу успеха следующей попытки усиления майнера. Не гарантирует успех." },
  { id: "xp_small", title: "XP", sub: "опыт", label: "XP", weight: 25, role: "steel", use: "Опыт уровня аккаунта." },
  { id: "focus_1", title: "Фокус", sub: "×1", label: "Фокус ×1", weight: 15, role: "amber", use: "Повышает вес нужного типа на колесе апгрейда (чаще выпадает выбранный стат)." },
  { id: "nothing", title: "Пусто", label: "Пусто", weight: 20, role: "void", use: "Пустой сектор — без награды." },
  { id: "ton_dust", title: "TON", sub: "пыль", label: "Пыль TON", weight: 20, role: "neon", use: "Небольшая сумма TON на баланс." },
  { id: "block_1", title: "Запрет", sub: "×1", label: "Запрет ×1", weight: 12, role: "magenta", use: "Блокирует выпадение одного нежелательного типа апгрейда." },
];
const WEIGHT_SUM = PRIZES.reduce((s, p) => s + p.weight, 0);
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

type Phase = "idle" | "wait" | "spin" | "done";

export function Wheel() {
  const dailySt = useDailyStatus();
  const dailyClaim = useDailyClaimFull();
  const wheelSt = useWheelStatus();
  const spinMut = useWheelSpin();
  const promo = usePromoRedeem();
  const toast = useToast();

  const wheel = useRef<PrizeWheelHandle>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [win, setWin] = useState<number | null>(null);
  const [last, setLast] = useState<SpinOut | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [code, setCode] = useState("");

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

  function onDaily() {
    dailyClaim.mutate(undefined, {
      onSuccess: (r) =>
        r.already_claimed
          ? toast({ kind: "info", title: "Сегодня уже отмечено", sub: `серия ${r.streak} дн · приходите завтра` })
          : toast({
              kind: "ok",
              title: "Отметка засчитана",
              sub: [
                `+${Number(r.reward_ton).toFixed(4)} TON`,
                r.reward_xp > 0 && `+${r.reward_xp} XP`,
                r.reward_focus > 0 && `Фокус +${r.reward_focus}`,
                `серия ${r.streak} дн`,
              ]
                .filter(Boolean)
                .join(" · "),
            }),
      onError: (e) => toast({ kind: "danger", title: "Отметка не прошла", sub: e.message }),
    });
  }

  function onPromo() {
    promo.mutate(code, {
      onSuccess: (r) => {
        setCode("");
        toast({ kind: "ok", title: "Промокод активирован", sub: r.code });
      },
      onError: (e) => toast({ kind: "danger", title: "Код не принят", sub: e.message }),
    });
  }

  if (dailySt.isLoading || wheelSt.isLoading) {
    return <LoadingPanel label="Загрузка колеса…" />;
  }

  const d = dailySt.data;
  const w = wheelSt.data;
  const left = w?.left_today ?? 0;
  const maxSpins = Math.max(w?.free_spins_per_day ?? 1, 1);
  const won = win != null ? PRIZES[win] : null;
  const miss = !!last && won?.id === "nothing" && rewardParts(last).length === 0;

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
      <Panel level="hero" cut="l" lift="l2" className="px-4 pb-0 pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-label">Бесплатные вращения</p>
          <span className="flex items-center gap-2">
            <span className="pw-pips" aria-hidden>
              {Array.from({ length: maxSpins }, (_, i) => (
                <i key={i} className={cx(i < left && "on")} />
              ))}
            </span>
            <Num value={`${left}/${maxSpins}`} size="s" decode={false} />
          </span>
        </div>
        <PrizeWheel ref={wheel} sectors={PRIZES} winIndex={phase === "done" ? win : null} spinning={phase === "spin"} miss={miss} className="my-4" />
        <Scrim className="relative -mx-4 space-y-3 px-4 pb-4 pt-3">
          <p className="ui-sec text-center !text-[12px]">
            {phase === "wait"
              ? "Связь с колесом…"
              : phase === "spin"
                ? "Тап по экрану — сразу к результату"
                : left > 0
                  ? "Сектор под указателем — ваша награда"
                  : "Новое бесплатное вращение — завтра"}
          </p>
          <span className="ui-spill block">
            <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy || left <= 0} onClick={onSpin}>
              {phase === "wait" ? "Связь…" : phase === "spin" ? "Вращение…" : left <= 0 ? "Вращения закончились" : "Крутить колесо"}
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
            <p className="ui-sec !text-[12px]">TON, опыт и фокус — раз в сутки</p>
          </div>
          <Tag tone={d?.claimed_today ? "ok" : "amber"}>{d?.claimed_today ? "получено" : "доступно"}</Tag>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Readout label="Серия" value={String(d?.streak ?? 0)} unit="дн" />
          <Readout label="Сегодня" value={d?.claimed_today ? "получено" : "доступно"} />
        </div>
        <Button kind="secondary" block icon={<IconBolt size={18} />} disabled={dailyClaim.isPending || !!d?.claimed_today} onClick={onDaily}>
          {d?.claimed_today ? "Уже получено" : dailyClaim.isPending ? "Начисление…" : "Забрать отметку"}
        </Button>
      </Panel>

      {/* Промокод */}
      <Panel className="space-y-4 p-5">
        <div className="min-w-0">
          <p className="ui-h">Промокод</p>
          <p className="ui-sec !text-[12px]">Один код — один раз на аккаунт</p>
        </div>
        <Field label="Код" error={promo.isError ? (promo.error instanceof Error ? promo.error.message : "Код не принят") : undefined}>
          <input
            className="ui-input uppercase tracking-wider"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (promo.isError) promo.reset();
            }}
            placeholder="NEXUS-START"
            disabled={promo.isPending}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button kind="secondary" block disabled={promo.isPending || code.trim().length < 3} onClick={onPromo}>
          {promo.isPending ? "Проверка…" : "Активировать"}
        </Button>
      </Panel>

      {dailyClaim.isError && (
        <ErrorPanel message={dailyClaim.error instanceof Error ? dailyClaim.error.message : "Отметка не прошла"} />
      )}

      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Призы и шансы">
        <p className="ui-sec !text-[13px]">Указатель сверху. После остановки сектор под ним — ваша награда.</p>
        <div className="mt-4 divide-y divide-[var(--line)]">
          {PRIZES.map((p) => (
            <div key={p.id} className="flex gap-3 py-3">
              <span className="pw-dot mt-[5px]" style={{ background: DOT[p.role] }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium leading-5 text-[var(--text)]">{p.label}</span>
                  <span className="ui-num text-[15px]">{Math.round((p.weight / WEIGHT_SUM) * 100)}%</span>
                </div>
                <p className="ui-sec mt-0.5 !text-[12px] !leading-[16px]">{p.use}</p>
              </div>
            </div>
          ))}
        </div>
        <Button kind="primary" block className="mt-4" onClick={() => setHelpOpen(false)}>
          Понятно
        </Button>
      </Sheet>
    </div>
  );
}
