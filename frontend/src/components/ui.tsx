/**
 * Старые имена компонентов экранов — теперь на наборе фазы 1 (components/ui/).
 * Экраны, которые ещё не переведены напрямую на набор, получают новый вид без правок.
 */
import type { ReactNode } from "react";
import { EmptyState, ErrorState, Num, SkeletonCard, Tag, type Tone } from "./ui/index";

export * from "./ui/index";

const PILL: Record<"neutral" | "live" | "warn" | "danger" | "ok", Tone> = {
  neutral: "neutral",
  live: "neon",
  warn: "warn",
  danger: "danger",
  ok: "ok",
};

/** Маркер статуса (старое имя Tag) */
export function StatusPill({ tone = "neutral", children }: { tone?: keyof typeof PILL; children: ReactNode }) {
  return <Tag tone={PILL[tone]}>{children}</Tag>;
}

/** Загрузка — скелетон с линией «СИНХРОНИЗАЦИЯ ▮▮▮▯▯» */
export function LoadingPanel({ label = "Синхронизация" }: { label?: string }) {
  return <SkeletonCard label={label.replace(/…$/, "")} lines={2} />;
}

/** Ошибка — магентовая кромка и «Реактор не отвечает» (повтор подключим в 1b) */
export function ErrorPanel({ message }: { message: string }) {
  return <ErrorState message={message} />;
}

export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return <EmptyState title={title} body={body} />;
}

/** Показание: подпись капсом, моно-цифра, единица, подсказка */
export function Readout({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="ui-label">{label}</p>
      <Num value={value} unit={unit} size="m" className="mt-1 block truncate !text-[19px] !font-bold" />
      {hint && <p className="ui-sys mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Кольцевая шкала. Герой «Gauge» из п. 9 — в 1b; здесь — токены вместо цветов
 * и CSS-переход вместо framer-motion.
 */
export function Gauge({ value, max = 100, label, sub }: { value: number; max?: number; label: string; sub?: string }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = 36;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[96px] w-[96px]">
        <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="48" cy="48" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="6" strokeDasharray="4 2" />
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke="var(--neon)"
            strokeWidth="6"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className="ui-gauge-arc"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Num value={Math.round(pct * 100)} size="m" className="!font-bold" />
          <span className="ui-label">%</span>
        </div>
      </div>
      <p className="ui-label mt-2">{label}</p>
      {sub && <p className="ui-sys mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * Шапка экрана: заголовок Tektur, действие справа.
 * Подпись капсом над заголовком — только если она что-то добавляет (раздел-родитель на вложенном экране,
 * тип объекта); повтор названия раздела другим словом не ставим (DESIGN п. 14.14).
 */
export function ScreenHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <header className={`flex justify-between gap-3 ${eyebrow ? "items-start" : "min-h-[40px] items-center"}`}>
      <div className="min-w-0">
        {eyebrow && <p className="ui-label">{eyebrow}</p>}
        <h1 className={`ui-title ui-shade truncate ${eyebrow ? "mt-1" : ""}`}>{title}</h1>
      </div>
      {action}
    </header>
  );
}
