import { forwardRef, type ReactNode } from "react";

/**
 * Общая кнопка закрытия шторок (DESIGN.md п. 7, «Шторка»): касание 44 × 44, видимый круг 36 —
 * металлический ободок, тёмная чаша и тонкое неоновое кольцо; крестик 16 px по центру круга.
 * margin-right −4 px: правый край круга совпадает с полем контента (16 px).
 */
export const CloseButton = forwardRef<HTMLButtonElement, { onClick: () => void; label?: string }>(function CloseButton(
  { onClick, label = "Закрыть" },
  ref,
) {
  return (
    <button ref={ref} type="button" className="ui-x" aria-label={label} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6L18 18M18 6L6 18" />
      </svg>
    </button>
  );
});

/** Общая шапка шторки: заголовок 17/24, подзаголовок 12/16 в одну строку, справа — крестик. Высота не меньше 44. */
export function SheetHeader({
  title,
  sub,
  id,
  onClose,
  closeRef,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** id заголовка — для aria-labelledby диалога */
  id?: string;
  onClose: () => void;
  closeRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div className="ui-sh-hd">
      <div className="t">
        <h2 className="tt" id={id}>
          {title}
        </h2>
        {sub ? <p className="ts">{sub}</p> : null}
      </div>
      <CloseButton ref={closeRef} onClick={onClose} />
    </div>
  );
}
