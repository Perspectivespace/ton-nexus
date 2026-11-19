import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

/* ── Достижения: типы и запросы (backend/app/api/achievements.py) ── */

export type AchBranch = "tasks" | "miner" | "games" | "level" | "ambassador";
export type AchMetal = "bronze" | "silver" | "gold" | "platinum" | "neon";
export type AchStatus = "paid" | "pending" | "rejected" | "baseline";

export type AchTierCfg = { at: number; ton: string; xp: number; enabled: boolean };
export type AchBranchCfg = { enabled: boolean; tiers: AchTierCfg[] };
/** настройка economy_settings «achievements» */
export type AchSettings = {
  enabled: boolean;
  retroactive: boolean;
  start_at: string | null;
  manual_from_ton: string;
  manual_low_integrity: boolean;
  branches: Record<AchBranch, AchBranchCfg>;
};

export type AchAward = {
  id: number;
  branch: AchBranch;
  tier: number;
  ton: string;
  xp: number;
  status: AchStatus;
  created_at: string | null;
  metal?: AchMetal;
  index?: number;
  of?: number;
};

export type AchOwnerSummary = {
  paid_ton: string;
  pending_ton: string;
  counts: Record<AchStatus, number>;
  pending: (AchAward & { user_id: number; user: string; telegram_id: number | null; integrity_tier: string | null })[];
  holders: { branch: AchBranch; tier: number; count: number }[];
};

export const ACH_BRANCHES: readonly AchBranch[] = ["tasks", "miner", "games", "level", "ambassador"];

/* владелец */
export function useAchOwner(enabled = true) {
  return useQuery({ queryKey: ["owner", "achievements"], queryFn: () => api<AchOwnerSummary>("/api/v1/achievements/owner"), enabled });
}

export function useAchSettings(enabled = true) {
  return useQuery({
    queryKey: ["economy", "achievements"],
    queryFn: () => api<{ key: string; value: AchSettings }>("/api/v1/economy/settings/achievements"),
    enabled,
  });
}

export function useAchSettingsSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: AchSettings) =>
      api<{ key: string; value: AchSettings }>("/api/v1/economy/settings/achievements", { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: (res) => {
      qc.setQueryData(["economy", "achievements"], res);
      qc.invalidateQueries({ queryKey: ["owner", "achievements"] });
      qc.invalidateQueries({ queryKey: ["achievements"] });
    },
  });
}

export function useAchDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      api<AchAward>(`/api/v1/achievements/owner/${id}/${approve ? "approve" : "reject"}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "achievements"] }),
  });
}
