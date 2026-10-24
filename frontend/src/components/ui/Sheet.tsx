import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";
import { WebApp } from "@/lib/telegram";

/**
 * Нижняя шторка: срез сверху с обеих сторон, неоновая ручка, выезд 260 мс, подложка 72 %.
 * Закрывается свайпом вниз за ручку, тапом по подложке, Esc и системной кнопкой «Назад» Telegram.
 * Высота — не больше 85 % экрана. Открытие — мягкая вибрация (п. 7, 11.2).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // монтируем → на следующий кадр выдвигаем; при закрытии ждём конец перехода
  useEffect(() => {
    if (open) {
      setMounted(true);
      haptic.sheet();
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    setDrag(0);
    const t = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(t);
  }, [open]);

  // системная «Назад» и Esc
  useEffect(() => {
    if (!open) return;
    const back = () => closeRef.current();
    const key = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", key);
    let bb: typeof WebApp.BackButton | null = null;
    try {
      if (WebApp.platform !== "unknown" && WebApp.isVersionAtLeast("6.1")) {
        bb = WebApp.BackButton;
        bb.onClick(back);
        bb.show();
      }
    } catch {
      bb = null;
    }
    return () => {
      window.removeEventListener("keydown", key);
      try {
        bb?.offClick(back);
        bb?.hide();
      } catch {
        /* вне Telegram */
      }
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="ui-sheet-root"
      data-open={shown ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      style={{ ["--drag" as string]: `${drag}px` }}
    >
      <div className="ui-sheet-scrim" onClick={() => closeRef.current()} aria-hidden />
      <div className="ui-sheet" role="dialog" aria-modal="true">
        <div
          className="grab-zone"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            startY.current = e.clientY;
            setDragging(true);
            setDrag(0);
          }}
          onPointerMove={(e) => {
            if (startY.current == null) return;
            setDrag(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            const d = drag;
            startY.current = null;
            setDragging(false);
            if (d > 80) closeRef.current();
            else setDrag(0);
          }}
          onPointerCancel={() => {
            startY.current = null;
            setDragging(false);
            setDrag(0);
          }}
        >
          <div className="grab" />
        </div>
        {title ? (
          <div className="s-head">
            <h2 className="ui-title">{title}</h2>
          </div>
        ) : null}
        <div className="s-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
