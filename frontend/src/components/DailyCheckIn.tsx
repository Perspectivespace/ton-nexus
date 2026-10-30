import { useState } from "react";
import { useDaily } from "@/lib/useDaily";
import { IconBolt, IconCheck, IconChevron } from "@/components/icons";
import { Button, Panel, Skeleton, Tag, cx } from "@/components/ui";
import { DailyWeek } from "@/components/DailyWeek";
import type { DailyStatus } from "@/api/hooks";

/** TON без лишних нулей: 0.0025 → «0.0025», 0.0010 → «0.001» */
const ton = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : v;
};

/** «1 день», «3 дня», «7 дней» */
export function days(n: number) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const w = a > 10 && a < 20 ? "дней" : b === 1 ? "день" : b >= 2 && b <= 4 ? "дня" : "дней";
  return `${n} ${w}`;
}

/** День цикла 1…7: с сервера (cycle_day), у старого сервера — из серии */
export function todayOf(d: Pick<DailyStatus, "cycle_day" | "streak" | "claimed_today"> | undefined) {
  if (!d) return 1;
  if (d.cycle_day) return d.cycle_day;
  const s = d.claimed_today ? d.streak : d.streak + 1;
  return ((Math.max(1, s) - 1) % 7) + 1;
}

/** «чч:мм:сс» → «чч:мм» с округлением вверх: последняя минута показывается как 00:01, не 00:00 */
export function hhmm(left: string | null | undefined) {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(left ?? "");
  if (!m) return left ?? "";
  const mins = Math.ceil((+m[1] * 3600 + +m[2] * 60 + +m[3]) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(mins / 60))}:${p(mins % 60)}`;
}

/**
 * Карточка «Ежедневная отметка» вверху «Заработка» (DESIGN.md §14.1).
 * Можно забрать — серия, полоса 7 дней с наградами с сервера (`rewards`) и кнопка «Забрать».
 * После отметки сворачивается в строку «Отметка получена · Серия N дней · следующая через чч:мм» с меткой «N / 7»;
 * тап по строке раскрывает полосу дней.
 */
export function DailyCheckIn({ className }: { className?: string }) {
  const daily = useDaily();
  const [open, setOpen] = useState(false);
  const d = daily.status;
  const today = todayOf(d);
  const streak = d?.streak ?? 0;
  const week = d?.rewards && d.rewards.length > 0 ? d.rewards : null;
  const cur = week?.find((x) => x.day === today);

  if (daily.loading && !d) {
    return (
      <Panel className={cx("p-4", className)}>
        <Skeleton h={44} />
      </Panel>
    );
  }

  if (daily.waiting) {
    return (
      <Panel className={cx("dc-card is-done", className)}>
        <button
          type="button"
          className="dc-row"
          aria-expanded={week ? open : undefined}
          disabled={!week}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="dc-ic ok" aria-hidden>
            <IconCheck size={20} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="flex items-center justify-between gap-2">
              <span className="dc-t">Отметка получена</span>
              <Tag tone="ok" dot={false}>
                {today} / 7
              </Tag>
            </span>
            <span className="dc-s">
              Серия {days(streak)} · <span className="whitespace-nowrap">следующая через <span className="ui-num">{hhmm(daily.countdown)}</span></span>
            </span>
          </span>
          {week && <IconChevron size={18} className={cx("dc-chev", open && "open")} />}
        </button>
        {open && week && (
          <div className="px-4 pb-4">
            <DailyWeek days={week} today={today} claimed={!!d?.claimed_today} streak={streak} caption={false} />
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel className={cx("dc-card space-y-3 p-4", className)}>
      <div className="flex items-center gap-3">
        <span className="dc-ic" aria-hidden>
          <IconBolt size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="dc-t">Ежедневная отметка</p>
          <p className="dc-s">{streak > 0 ? `Серия ${days(streak)} · не прерывайте` : "Начните серию — награда растёт 7 дней"}</p>
        </div>
        <Tag tone="amber" dot={false}>
          {today} / 7
        </Tag>
      </div>
      {week && (
        <DailyWeek days={week} today={today} claimed={false} streak={streak} caption={false} />
      )}
      <span className="ui-spill">
        <Button kind="primary" size="lg" block icon={<IconBolt size={18} />} disabled={!daily.ready} onClick={daily.claimNow}>
          {daily.pending ? "Начисление…" : cur ? `Забрать · +${ton(cur.ton)} TON` : "Забрать"}
        </Button>
      </span>
    </Panel>
  );
}
