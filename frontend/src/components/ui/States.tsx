import type { ReactNode } from "react";
import { IconAlert, IconEmpty, IconRefresh } from "../icons";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { cx } from "./press";

/** Строка «СИНХРОНИЗАЦИЯ ▮▮▮▯▯» — статично, без анимации свечения */
export function SyncLine({ label = "Синхронизация", step = 3, of = 5, className }: { label?: string; step?: number; of?: number; className?: string }) {
  return (
    <span className={cx("ui-sync ui-sys uppercase", className)} aria-label={label}>
      <span>{label}</span>
      <span aria-hidden>
        {Array.from({ length: of }, (_, i) => (
          <i key={i} className={i < step ? "on" : undefined} />
        ))}
      </span>
    </span>
  );
}

/** Полоса-заглушка по форме контента; ширина в % или px */
export function Skeleton({ w = "100%", h = 10, className }: { w?: number | string; h?: number; className?: string }) {
  return <span className={cx("ui-sk block", className)} style={{ width: w, height: h }} aria-hidden />;
}

/** Скелетон карточки: подпись, крупная цифра, строки */
export function SkeletonCard({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <Panel className="p-4" aria-busy="true">
      <div className="grid gap-3">
        <Skeleton w="34%" h={8} />
        <Skeleton w="62%" h={24} />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} w={`${88 - i * 14}%`} />
        ))}
        <SyncLine label={label} />
      </div>
    </Panel>
  );
}

/** Пусто: пунктирная иконка, заголовок, подсказка, необязательное действие */
export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Panel className="ui-state">
      <span className="st-ic">{icon ?? <IconEmpty size={32} />}</span>
      <p className="ui-h">{title}</p>
      {body ? <p className="ui-sec max-w-[32ch]">{body}</p> : null}
      {action}
    </Panel>
  );
}

/** Ошибка: магентовая кромка, «Реактор не отвечает», код, «Повторить» */
export function ErrorState({
  title = "Реактор не отвечает",
  message,
  code,
  onRetry,
}: {
  title?: ReactNode;
  message?: ReactNode;
  code?: string;
  onRetry?: () => void;
}) {
  return (
    <Panel danger className="ui-state err" role="alert">
      <span className="st-ic">
        <IconAlert size={30} />
      </span>
      <p className="ui-h">{title}</p>
      {message ? <p className="ui-sec max-w-[34ch] break-words">{message}</p> : null}
      {code ? <p className="ui-sys">КОД {code}</p> : null}
      {onRetry ? (
        <Button kind="secondary" size="sm" icon={<IconRefresh size={18} />} onClick={onRetry} className="mt-2">
          Повторить
        </Button>
      ) : null}
    </Panel>
  );
}
