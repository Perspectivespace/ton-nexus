import type { TaskOut } from "@/api/types";
import { t } from "@/i18n";
import { AchBadge } from "./AchBadge";
import { ambTitle } from "./text";

/** Значок амбассадора на карточке задания: высшая ступень ветки «Размещения» у автора */
export function AuthorBadge({ badge }: { badge: NonNullable<TaskOut["creator_badge"]> }) {
  const title = ambTitle(badge.index);
  return (
    <span className={`ach-auth m-${badge.metal}`} aria-label={t("ach.authorBadge", { title })}>
      <AchBadge metal={badge.metal} branch="ambassador" size={18} />
      <span aria-hidden>{title}</span>
    </span>
  );
}
