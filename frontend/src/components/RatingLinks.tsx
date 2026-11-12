import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Panel } from "@/components/ui";
import { IconChevron, IconTasks, IconTower, IconUp } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { prefetchRoute } from "@/lib/routes";
import { monthInline, mskMonth } from "@/lib/tower/month";
import { useRatingSummary } from "@/api/hooks";
import type { RatingKind, RatingSummary } from "@/api/types";
import "@/styles/ratings.css";
import { fmtNum, ordSuffix, t, tp } from "@/i18n";

/*
 * Рейтинги: вкладки (значок и акцент) и точки входа — «Мои места» в Профиле и «Топ исполнителей» в Заработке.
 * Отдельно от экрана /ratings, чтобы Профиль и Заработок не тянули его в свой чанк.
 */

/** чанк экрана рейтингов — заранее, при наведении/касании */
const warm = () => void prefetchRoute("/ratings");
const fmt = (n: number) => fmtNum(n);
const players = (n: number) => `${fmt(n)} ${tp("ratings.players", n)}`;

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
  { k: "level", get label() { return t("ratings.kindLevel"); }, Icon: IconUp, acc: "var(--neon)" },
  { k: "tasks", get label() { return t("ratings.kindTasks"); }, Icon: IconTasks, acc: "var(--ok)" },
  { k: "friends", get label() { return t("ratings.kindFriends"); }, Icon: IconFriends, acc: "var(--magenta)" },
  { k: "tower", get label() { return t("ratings.kindTower"); }, Icon: IconTower, acc: "var(--amber)" },
];
export const kindOf = (k: Kind) => KINDS.find((x) => x.k === k)!;

const CELLS: { k: "level" | "tasks" | "tower"; label: string }[] = [
  { k: "level", get label() { return t("ratings.kindLevel"); } },
  { k: "tasks", get label() { return t("ratings.kindTasks"); } },
  { k: "tower", get label() { return t("ratings.kindTower"); } },
];

/** Профиль: «Мои места» — три ячейки-ссылки на свои вкладки + «Все рейтинги» */
export function ProfileRanks() {
  const s = useRatingSummary().data;
  return (
    <Panel className="rt-strip">
      <Link to="/ratings?from=profile" className="rt-strip-hd no-underline" onClick={() => haptic.tap()} onPointerEnter={warm}>
        <span className="ui-label">{t("ratings.myPlaces")}</span>
        <span className="rt-all">
          {t("ratings.all")}<IconChevron size={16} />
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
              aria-label={rank != null ? t("ratings.placeAria", { label, rank }) : t("ratings.noPlaceAria", { label })}
              onClick={() => haptic.tap()}
              onPointerEnter={warm}
            >
              <span className="rt-cic">
                <K.Icon size={16} />
              </span>
              {rank != null ? (
                <span className="rt-cn">
                  {fmt(rank)}
                  <span className="rt-cpl">{ordSuffix(rank, "ratings.ordPlace")}</span>
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
  if (!s) return t("ratings.tasksTopWho");
  if (s.tasks.rank == null) return s.tasks.total ? t("ratings.tasksTopIn", { total: players(s.tasks.total) }) : t("ratings.tasksTopOne");
  return t("ratings.youOf", { rank: fmt(s.tasks.rank), total: fmt(s.tasks.total) });
}

/** Заработок: ссылка «Топ исполнителей · октябрь» над лентой заданий */
export function TasksTopLink() {
  const s = useRatingSummary().data;
  const month = monthInline(s?.month ?? mskMonth());
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
        <span className="rt-ctx-t">{t("ratings.tasksTopMonth", { month })}</span>
        <span className="rt-ctx-s">{tasksTopSub(s)}</span>
      </span>
      <IconChevron size={18} className="rt-chev" />
    </Link>
  );
}
