import markDark from "@/assets/brand/mark.svg";
import markLight from "@/assets/brand/mark-light.svg";
import wordDark from "@/assets/brand/wordmark.svg";
import wordLight from "@/assets/brand/wordmark-light.svg";

/**
 * Знак «Печать» (docs/DESIGN.md, п. 9). Две версии — для тёмной и светлой темы,
 * нужная показывается через [data-theme] в CSS, без JS. Меньше 24 px знак не ставим — там фавикон.
 */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`brand-pair ${className}`} style={{ width: size, height: size }} aria-hidden>
      <img className="b-dark" src={markDark} width={size} height={size} alt="" draggable={false} />
      <img className="b-light" src={markLight} width={size} height={size} alt="" draggable={false} />
    </span>
  );
}

export function BrandWordmark({ height = 12, className = "" }: { height?: number; className?: string }) {
  const w = Math.round((height * 313.5) / 44);
  return (
    <span className={`brand-pair ${className}`} style={{ width: w, height }} aria-hidden>
      <img className="b-dark" src={wordDark} width={w} height={height} alt="" draggable={false} />
      <img className="b-light" src={wordLight} width={w} height={height} alt="" draggable={false} />
    </span>
  );
}

/** Шапка приложения (п. 9.5): знак 28 px + надпись. */
export function AppHeader() {
  return (
    <header className="app-brand on-city mx-auto flex w-full max-w-lg items-center gap-2.5 px-4 pt-3">
      <BrandMark size={28} />
      <BrandWordmark height={12} />
      <span className="sr-only">TON Nexus</span>
    </header>
  );
}
