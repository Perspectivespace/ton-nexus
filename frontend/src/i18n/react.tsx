import { Fragment, useCallback, type ReactNode } from "react";
import { useLangStore, t, type Key } from "./core";

/**
 * t в компоненте с подпиской на язык. Обычный t() тоже можно звать при рендере: при смене языка
 * приложение перемонтируется целиком (LangRoot), поэтому строки обновятся везде.
 */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((key: Key, vars?: Record<string, string | number>) => t(key, vars), [lang]);
}

/** Корень, перемонтируемый при смене языка: строки из t() во всех разделах пересчитываются */
export function LangRoot({ children }: { children: ReactNode }) {
  const lang = useLangStore((s) => s.lang);
  return <Fragment key={lang}>{children}</Fragment>;
}
