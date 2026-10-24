import type { ReactNode } from "react";
import { cx } from "./press";

type FieldProps = {
  /** подпись сверху — Onest 13 */
  label?: ReactNode;
  /** единица справа — Tektur капсом (TON, XP, %) */
  unit?: ReactNode;
  /** подсказка под полем */
  hint?: ReactNode;
  /** текст ошибки: маджента-кромка и что исправить */
  error?: ReactNode;
  className?: string;
  /** само поле: <input className="ui-input" />, <textarea className="ui-input" />, <select className="ui-input" /> */
  children: ReactNode;
};

/**
 * Поле ввода (docs/DESIGN.md, п. 7 «Поля ввода»): высота 48, утоплено (e0), срезан один угол,
 * значение — Mono 16, циановый курсор. Фокус — циановая кромка, светящаяся линия снизу и перелив изнутри.
 * Логику поля (value, onChange, disabled) задаёт сам input — обёртка только рисует.
 */
export function Field({ label, unit, hint, error, className, children }: FieldProps) {
  return (
    <label className={cx("ui-fieldset", className)}>
      {label != null && <span className="ui-flabel">{label}</span>}
      <span className={cx("ui-field", error ? "err" : undefined)}>
        {children}
        {unit != null && <span className="unit">{unit}</span>}
      </span>
      {error ? <span className="ui-fhint err">{error}</span> : hint ? <span className="ui-fhint">{hint}</span> : null}
    </label>
  );
}
