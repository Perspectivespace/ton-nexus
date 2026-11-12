/**
 * Поиск кириллицы в коде (для теста noCyrillic): комментарии вырезаются, строки и JSX-текст остаются.
 * Отдельным модулем, чтобы тест и скрипт проверки пользовались одним разбором.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (quote === null) {
      if (src.startsWith("//", i)) {
        let j = src.indexOf("\n", i);
        if (j < 0) j = n;
        out += " ".repeat(j - i);
        i = j;
        continue;
      }
      if (src.startsWith("/*", i)) {
        let j = src.indexOf("*/", i + 2);
        j = j < 0 ? n : j + 2;
        out += src.slice(i, j).replace(/[^\n]/g, " ");
        i = j;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === quote || (c === "\n" && quote !== "`")) quote = null;
    out += c;
    i++;
  }
  return out;
}

const CYR = /[\u0400-\u04FF]/;

/** Строки кода (без комментариев) с кириллицей: [номер строки, текст] */
export function cyrillicLines(src: string): Array<[number, string]> {
  return stripComments(src)
    .split("\n")
    .map((l, k) => [k + 1, l.trim()] as [number, string])
    .filter(([, l]) => CYR.test(l));
}
