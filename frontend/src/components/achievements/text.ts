import { t, fmtNum } from "@/i18n";
import type { AchBranch, AchMetal, AchStatus } from "@/api/achievements";

export const branchName = (b: AchBranch) => t(`ach.branch.${b}` as Parameters<typeof t>[0]);
export const branchMetric = (b: AchBranch) => t(`ach.metric.${b}` as Parameters<typeof t>[0]);
export const branchHow = (b: AchBranch) => t(`ach.how.${b}` as Parameters<typeof t>[0]);
export const metalName = (m: AchMetal) => t(`ach.metal.${m}` as Parameters<typeof t>[0]);
/** звание амбассадора по номеру ступени (1…5; ступеней больше — последнее звание) */
export const ambTitle = (index: number) => t(`ach.amb.${Math.min(5, Math.max(1, index))}` as Parameters<typeof t>[0]);
export const statusName = (s: AchStatus | null) => t(`ach.status.${s ?? "locked"}` as Parameters<typeof t>[0]);
/** «0.1 TON» без лишних нулей; 0 — пусто */
export const tonText = (ton: string) => (Number(ton) > 0 ? `${fmtNum(Number(ton), { maximumFractionDigits: 8 })} TON` : "");
/** название ступени: для амбассадора — звание, иначе «Ветка · порог» */
export const tierTitle = (b: AchBranch, at: number, index: number) =>
  b === "ambassador" ? ambTitle(index) : `${branchName(b)} · ${fmtNum(at)}`;
