import type { CSSProperties } from "react";
import { fmtTon } from "@/lib/arena/api";
import { type ArenaPosterModel } from "@/lib/arena/poster";
import { t, tp } from "@/i18n";

/**
 * Афиша на экране фасада чаши (PR 5): всегда живое состояние Арены, никогда заглушка покупки.
 * Облик — тот же янтарный экран, что у facade_screen; тексты короткие, чтобы влезать на 360.
 */
export function ArenaPoster({
  style,
  model,
  still = false,
}: {
  style: CSSProperties;
  model: ArenaPosterModel;
  still?: boolean;
}) {
  const stake = model.stakeNano ? t("poster.stakeFrom", { stake: fmtTon(model.stakeNano) }) : null;
  const title =
    model.kind === "closed" ? t("poster.closedTitle") : model.kind === "queue" ? tp("poster.waiting", model.waiting) : t("poster.openTitle");
  const sub = model.kind === "closed" ? t("poster.closedSub") : stake ?? (model.kind === "open" ? t("poster.openSub") : null);
  return (
    <div
      className={`dz-idle k-facade_screen dz-poster${still ? " still" : ""}${model.kind === "closed" ? " is-closed" : ""}`}
      style={style}
      data-spot="arena_facade"
      data-kind="poster"
    >
      <span className="in">
        <span className="tag">{t("poster.kicker")}</span>
        <span className="t">{title}</span>
        {sub && <span className="p">{sub}</span>}
      </span>
    </div>
  );
}

/** Плашка «Вход» у золотых ворот — только визуал; касание ловит .dz-hit на всём проёме. */
export function ArenaGateMark({ style }: { style: CSSProperties }) {
  return (
    <div className="az-gate" style={style} aria-hidden="true">
      <span className="az-gate-plate">
        <span className="az-gate-k">{t("gate.enter")}</span>
      </span>
    </div>
  );
}
