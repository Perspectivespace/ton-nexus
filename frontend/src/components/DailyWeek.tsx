import type { DailyDay } from "@/api/hooks";
import { cx } from "@/components/ui";
import { IconCheck } from "@/components/icons";

type State = "done" | "today" | "got" | "next";

/** TON без лишних нулей: 0.0025 → «0.0025», 0.0010 → «0.001» */
function ton(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : v;
}

/**
 * Полоса «7 дней по кругу» (Ночной контур): пройденные дни — зелёная галочка,
 * сегодняшний — натриевая подсветка (или зелёная, если уже забрано), будущие — приглушены.
 * Дорожка под плитками заполняется до сегодняшнего дня. День 7 — с бонусом Фокус.
 */
export function DailyWeek({
  days,
  today,
  claimed,
  streak,
  caption = true,
}: {
  days: DailyDay[];
  today: number;
  claimed: boolean;
  streak: number;
  /** строка «Сегодня · день N из 7: +… TON» под полосой (в карточке «Заработка» её заменяет кнопка) */
  caption?: boolean;
}) {
  const cur = days.find((d) => d.day === today);
  const fill = Math.max(0, Math.min(1, (today - (claimed ? 0 : 1)) / days.length));
  const round = streak > 7 || (!claimed && streak >= 7) ? Math.floor((claimed ? streak - 1 : streak) / 7) + 1 : 1;
  return (
    <div className={caption ? "space-y-3" : undefined}>
      <div className="dw" role="list" aria-label="Награды 7 дней">
        <span className="dw-track" aria-hidden>
          <span className="dw-fill" style={{ transform: `scaleX(${fill})` }} />
        </span>
        {days.map((d) => {
          const st: State = d.day < today ? "done" : d.day > today ? "next" : claimed ? "got" : "today";
          return (
            <div
              key={d.day}
              role="listitem"
              className={cx("dw-day", st, d.focus > 0 && "bonus")}
              aria-label={`День ${d.day}: ${ton(d.ton)} TON, ${d.xp} XP${d.focus ? `, Фокус +${d.focus}` : ""}${st === "done" || st === "got" ? " — получено" : st === "today" ? " — сегодня" : ""}`}
            >
              <span className="dw-k">{st === "today" || st === "got" ? "сег" : `д${d.day}`}</span>
              <span className="dw-ic" aria-hidden>
                {st === "done" || st === "got" ? <IconCheck size={14} /> : d.focus > 0 ? <b>Ф</b> : <i>{d.day}</i>}
              </span>
              <span className="dw-v">{ton(d.ton)}</span>
              <span className="dw-p">+{d.xp} xp</span>
            </div>
          );
        })}
      </div>
      {caption && cur && (
        <p className="ui-sec !text-[12px] !leading-[16px]">
          <span className="text-[var(--text)]">
            {claimed ? "Получено сегодня" : "Сегодня"} · день {today} из 7
            {round > 1 ? ` · круг ${round}` : ""}:
          </span>{" "}
          <span className="ui-num">
            +{ton(cur.ton)} TON · +{cur.xp} XP{cur.focus > 0 ? ` · Фокус +${cur.focus}` : ""}
          </span>
        </p>
      )}
    </div>
  );
}
