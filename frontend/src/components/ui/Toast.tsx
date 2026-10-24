import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { IconAlert, IconBolt, IconCheck, IconClose, IconBell } from "../icons";
import { cx } from "./press";

export type ToastKind = "ok" | "amber" | "danger" | "info";
export type ToastInput = { kind?: ToastKind; title: ReactNode; sub?: ReactNode };
type ToastState = ToastInput & { id: number; leaving?: boolean };

const Ctx = createContext<((t: ToastInput) => void) | null>(null);

const ICON = { ok: IconCheck, amber: IconBolt, danger: IconAlert, info: IconBell } as const;

/**
 * Тост сверху: слой e2, цветная полоса 3 px слева. ok — мятный, amber — награда, danger — ошибка, info — голубой.
 * Сам уходит через 3 с; ошибка висит до закрытия. Одновременно — один (новый заменяет старый).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast((t) => (t ? { ...t, leaving: true } : t));
    timer.current = window.setTimeout(() => setToast(null), 170);
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      window.clearTimeout(timer.current);
      const kind = t.kind ?? "info";
      if (kind === "danger") haptic.error();
      else if (kind === "ok" || kind === "amber") haptic.success();
      setToast({ ...t, kind, id: ++seq.current });
      if (kind !== "danger") timer.current = window.setTimeout(dismiss, 3000);
    },
    [dismiss],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="ui-toast-wrap" aria-live="polite" role="status">
        {toast ? <ToastView key={toast.id} toast={toast} onClose={dismiss} /> : null}
      </div>
    </Ctx.Provider>
  );
}

export function ToastView({ toast, onClose }: { toast: ToastState | (ToastInput & { leaving?: boolean }); onClose?: () => void }) {
  const kind = toast.kind ?? "info";
  const Icon = ICON[kind];
  return (
    <div className="ui-lift w-full max-w-[26rem]">
      <div className={cx("ui-cut e2 ui-toast", kind, toast.leaving && "out")} role={kind === "danger" ? "alert" : undefined}>
        <Icon size={22} className="t-ic" />
        <div className="t-main">
          <p className="t-ttl">{toast.title}</p>
          {toast.sub ? <p className="t-sub">{toast.sub}</p> : null}
        </div>
        {onClose ? (
          <button type="button" className="t-x" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** const toast = useToast(); toast({ kind: "ok", title: "Собрано", sub: "+12.5 TON" }) */
export function useToast() {
  const ctx = useContext(Ctx);
  return ctx ?? (() => {});
}
