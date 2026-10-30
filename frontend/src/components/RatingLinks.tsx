import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Panel } from "@/components/ui";
import { IconChevron, IconTasks, IconTower, IconUp } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { prefetchRoute } from "@/lib/routes";
import { plural } from "@/lib/friendRule";
import { monthTitle, mskMonth } from "@/lib/tower/month";
import { useRatingSummary } from "@/api/hooks";
import type { RatingKind, RatingSummary } from "@/api/types";
import "@/styles/ratings.css";

/*
 * Рейтинги: вкладки (значок и акцент) и точки входа — «Мои места» в Профиле и «Топ исполнителей» в Заработке.
 * Отдельно от экрана /ratings, чтобы Профиль и Заработок не тянули его в свой чанк.
 */

/** чанк экрана рейтингов — заранее, при наведении/касании */
const warm = () => void prefetchRoute("/ratings");
const fmt = (n: number) => n.toLocaleString("ru-RU");
const players = (n: number) => `${fmt(n)} ${plural(n, "игрок", "игрока", "игроков")}`;

export type Kind = RatingKind | "tower";

/** Значок «друзья»: два силуэта, та же сетка 24 и обводка, что у набора иконок */
export function IconFriends({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="ui-icon" aria-hidden="true">
      <path d="M7 4h4l1.5 1.5v4L11 11H7L5.5 9.5v-4z" />
      <path d="M2.5 20v-2.5L5 15h8l2.5 2.5V20" />
      <path d="M15 5h2.5L19 6.5v3.5L17.5 11.5H15" />
      <path d="M17 15h2l2.5 2.5V20" />
    </svg>
  );
}

export const KINDS: {
  k: Kind;
  label: string;
  Icon: (p: { size?: number }) => ReactNode;
  acc: string;
}[] = [
  { k: "level", label: "Уровень", Icon: IconUp, acc: "var(--neon)" },
  { k: "tasks", label: "Задания", Icon: IconTasks, acc: "var(--ok)" },
  { k: "friends", label: "Друзья", Icon: IconFriends, acc: "var(--magenta)" },
  { k: "tower", label: "Башня", Icon: IconTower, acc: "var(--amber)" },
];
export const kindOf = (k: Kind) => KINDS.find((x) => x.k === k)!;

const CELLS: { k: "level" | "tasks" | "tower"; label: string }[] = [
  { k: "level", label: "Уровень" },
  { k: "tasks", label: "Задания" },
  { k: "tower", label: "Башня" },
];

/** Профиль: «Мои места» — три ячейки-ссылки на свои вкладки + «Все рейтинги» */
export function ProfileRanks() {
  const s = useRatingSummary().data;
  return (
    <Panel className="rt-strip">
      <Link to="/ratings?from=profile" className="rt-strip-hd no-underline" onClick={() => haptic.tap()} onPointerEnter={warm}>
        <span className="ui-label">Мои места</span>
        <span className="rt-all">
          Все рейтинги
          <IconChevron size={16} />
        </span>
      </Link>
      <div className="rt-cells">
        {CELLS.map(({ k, label }) => {
          const K = kindOf(k);
          const rank = s?.[k].rank ?? null;
          return (
            <Link
              key={k}
              to={`/ratings?t=${k}&from=profile`}
              className="rt-cell no-underline"
              style={{ "--acc": K.acc } as CSSProperties}
              aria-label={rank != null ? `${label}: ${rank}-е место` : `${label}: пока без места`}
              onClick={() => haptic.tap()}
              onPointerEnter={warm}
            >
              <span className="rt-cic">
                <K.Icon size={16} />
              </span>
              {rank != null ? (
                <span className="rt-cn">
                  {fmt(rank)}
                  <span className="rt-cpl">-е</span>
                </span>
              ) : (
                <span className="rt-cn rt-cnone">—</span>
              )}
              <span className="rt-cl">{label}</span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

/** Подпись «Топ исполнителей»: место за месяц или как туда попасть */
export function tasksTopSub(s?: RatingSummary): string {
  if (!s) return "Кто выполнил больше заданий";
  if (s.tasks.rank == null) return s.tasks.total ? `${players(s.tasks.total)} в топе · одно задание — и вы там` : "Одно принятое задание — и вы в топе";
  return `Вы ${fmt(s.tasks.rank)}-й из ${fmt(s.tasks.total)}`;
}

/** Заработок: ссылка «Топ исполнителей · октябрь» над лентой заданий */
export function TasksTopLink() {
  const s = useRatingSummary().data;
  const month = monthTitle(s?.month ?? mskMonth()).toLowerCase();
  return (
    <Link
      to="/ratings?t=tasks&from=tasks"
      className="rt-ctx no-underline"
      style={{ "--acc": "var(--ok)" } as CSSProperties}
      onClick={() => haptic.tap()}
      onPointerEnter={warm}
    >
      <span className="rt-cic">
        <IconTasks size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="rt-ctx-t">{`Топ исполнителей · ${month}`}</span>
        <span className="rt-ctx-s">{tasksTopSub(s)}</span>
      </span>
      <IconChevron size={18} className="rt-chev" />
    </Link>
  );
}
