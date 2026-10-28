import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Раскрытие панели баланса на Главной (DESIGN.md п. 3.8): мягкая пружина ≈ 0,3 с по высоте + проявление.
 * Отдельный чанк — framer-motion не входит в стартовую загрузку (главная в стартовом чанке);
 * чанк подтягивается в простое после загрузки главной и по касанию панели.
 * «Уменьшить движение» — мгновенно.
 */
export default function HomePanelMore({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="more"
          id={id}
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { height: { type: "spring", duration: 0.32, bounce: 0.12 }, opacity: { duration: 0.2, ease: "easeOut" } }
          }
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
