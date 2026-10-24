import type { ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cx } from "./press";

export type TabItem<T extends string> = { value: T; label: ReactNode };

/**
 * Переключатель: «blocks» — до 3 пунктов, утопленный трек и приподнятый светящийся активный;
 * «line» — 4 и больше, капс Tektur с неоновой чертой снизу (п. 7). Выбор — selectionChanged.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  kind,
  className,
  label,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (v: T) => void;
  kind?: "blocks" | "line";
  className?: string;
  label?: string;
}) {
  const k = kind ?? (items.length <= 3 ? "blocks" : "line");
  return (
    <div role="tablist" aria-label={label} className={cx(k === "blocks" ? "ui-tabs" : "ui-segline", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={it.value === value}
          className={k === "blocks" ? "ui-tab" : undefined}
          onClick={() => {
            if (it.value !== value) {
              haptic.select();
              onChange(it.value);
            }
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
