import { useEffect, useMemo, useState } from "react";
import { haptic } from "@/lib/haptics";
import { t, type Key } from "@/i18n";
import { addDays, addMonths, fmtDay, monthGrid, monthOf, monthTitle } from "@/lib/cityAdBuy";

const WD = [1, 2, 3, 4, 5, 6, 7].map((i) => `ad.wd.${i}` as Key);

/**
 * Календарь начала показа: с завтрашнего дня (МСК) до +90 дней. Занятые сутки (из расчёта сервера) — заштрихованы;
 * выбранный срок подсвечен, сутки срока, которые уже заняты, — маджентой.
 */
export function AdCalendar({
  start,
  days,
  earliest,
  latest,
  busy,
  onPick,
}: {
  start: string;
  days: number;
  earliest: string;
  latest: string;
  busy: string[];
  onPick: (d: string) => void;
}) {
  const [ym, setYm] = useState(() => monthOf(start));
  // начало сменилось снаружи (ближайшая свободная дата в другом месяце) — листаем к нему
  useEffect(() => setYm(monthOf(start)), [start]);
  const busySet = useMemo(() => new Set(busy), [busy]);
  const end = addDays(start, days - 1);
  const first = monthOf(earliest);
  const last = monthOf(latest);
  const weeks = monthGrid(ym);
  return (
    <div className="cab-cal">
      <div className="cab-cal-head">
        <button
          type="button"
          className="cab-cal-nav"
          aria-label={t("ad.prevMonth")}
          disabled={ym <= first}
          onClick={() => {
            haptic.select();
            setYm(addMonths(ym, -1));
          }}
        >
          ‹
        </button>
        <b aria-live="polite">{monthTitle(ym)}</b>
        <button
          type="button"
          className="cab-cal-nav"
          aria-label={t("ad.nextMonth")}
          disabled={ym >= last}
          onClick={() => {
            haptic.select();
            setYm(addMonths(ym, 1));
          }}
        >
          ›
        </button>
      </div>
      <div className="cab-cal-grid" role="grid" aria-label={t("ad.calAria", { ym: monthTitle(ym) })}>
        {WD.map((w) => (
          <span key={w} className="cab-wd" role="columnheader">
            {t(w)}
          </span>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <span key={`e${i}`} className="cab-day e" />;
          const out = d < earliest || d > latest;
          const isBusy = busySet.has(d);
          const inRange = d >= start && d <= end;
          const cls = [
            "cab-day",
            out && "out",
            isBusy && "busy",
            inRange && "in",
            inRange && isBusy && "clash",
            d === start && "first",
            d === end && "last",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={cls}
              disabled={out || isBusy}
              aria-selected={d === start}
              aria-label={`${fmtDay(d)}${isBusy ? t("ad.busyAria") : ""}`}
              onClick={() => {
                haptic.select();
                onPick(d);
              }}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <div className="cab-cal-legend" aria-hidden="true">
        <span>
          <i className="lg in" />{" "}{t("ad.yourRun")}</span>
        <span>
          <i className="lg busy" />{" "}{t("ad.busy")}</span>
      </div>
    </div>
  );
}
