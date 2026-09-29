import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { MeOut, MinerOut, TaskOut } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeOut>("/api/v1/me"),
  });
}

export function useMiner() {
  return useQuery({
    queryKey: ["miner"],
    queryFn: () => api<MinerOut>("/api/v1/miner"),
  });
}

export function useMinerStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<MinerOut>("/api/v1/miner/start", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miner"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useMinerClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ miner: MinerOut; claimed: string }>("/api/v1/miner/claim", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miner"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<TaskOut[]>("/api/v1/tasks"),
  });
}

export function useDailyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/v1/daily/claim", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
    },
  });
}

export type UpgradeOut = {
  upgrade_type: string;
  cost: string;
  success_chance_bp: number;
  success: boolean;
  new_level: number | null;
  used_focus: boolean;
  used_block_type: string | null;
  burned: boolean;
};

export function useMinerUpgrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { use_focus_on?: string | null; block_type?: string | null }) =>
      api<UpgradeOut>("/api/v1/miner/upgrade", {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miner"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export type DailyStatus = {
  claimed_today: boolean;
  streak: number;
  check_date: string;
};

export type DailyClaim = {
  already_claimed: boolean;
  streak: number;
  reward_ton: string;
  reward_xp: number;
  reward_focus: number;
  check_date: string;
};

export function useDailyStatus() {
  return useQuery({
    queryKey: ["daily"],
    queryFn: () => api<DailyStatus>("/api/v1/daily/status"),
  });
}

export function useDailyClaimFull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DailyClaim>("/api/v1/daily/claim", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
    },
  });
}

export type WheelStatus = {
  free_spins_per_day: number;
  used_today: number;
  left_today: number;
};

export type SpinOut = {
  item_id: string;
  label: string;
  reward_ton: string;
  reward_xp: number;
  reward_focus: number;
  reward_block: number;
  success_boost_bp: number;
  free_spins_left_today: number;
};

export function useWheelStatus() {
  return useQuery({
    queryKey: ["wheel"],
    queryFn: () => api<WheelStatus>("/api/v1/wheel/status"),
  });
}

export function useWheelSpin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SpinOut>("/api/v1/wheel/spin", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["wheel"] });
    },
  });
}

export type TaskDetail = {
  id: number;
  title: string;
  description: string;
  task_type: string;
  target_url: string | null;
  reward: string;
  total_slots: number;
  filled_slots: number;
  status: string;
  min_level: number;
  xp_reward: number;
  creator_id: number;
  expires_at?: string | null;
};

export type SubmissionOut = {
  id: number;
  task_id: number;
  user_id: number;
  status: string;
  proof_text: string | null;
  proof_url: string | null;
  review_note: string | null;
};

export function useTask(taskId: number | null) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<TaskDetail>(`/api/v1/tasks/${taskId}`),
    enabled: taskId != null && taskId > 0,
  });
}

export function useTaskSubmit(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { proof_text?: string | null; proof_url?: string | null }) =>
      api<SubmissionOut>(`/api/v1/tasks/${taskId}/submit`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}

export type EconomySetting = {
  key: string;
  value: unknown;
  description: string | null;
  group: string | null;
  label: string | null;
};

export function useEconomySettings() {
  return useQuery({
    queryKey: ["economy"],
    queryFn: () => api<EconomySetting[]>("/api/v1/economy/settings"),
  });
}

export function useEconomyUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api<EconomySetting>(`/api/v1/economy/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["economy"] }),
  });
}

export type InboxSubmission = {
  id: number;
  task_id: number;
  user_id: number;
  status: string;
  proof_text: string | null;
  proof_url: string | null;
  review_note: string | null;
};

export function usePendingSubmissions() {
  return useQuery({
    queryKey: ["inbox", "submissions"],
    queryFn: () => api<InboxSubmission[]>("/api/v1/tasks/inbox/pending"),
  });
}

export function useReviewSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      approve,
      note,
    }: {
      id: number;
      approve: boolean;
      note?: string | null;
    }) =>
      api<InboxSubmission>(`/api/v1/tasks/submissions/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ approve, note: note || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function usePendingTaskApprovals() {
  return useQuery({
    queryKey: ["inbox", "task-approvals"],
    queryFn: () => api<TaskOut[]>("/api/v1/tasks/approval/pending"),
    retry: false,
  });
}

export function useApproveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) =>
      api<TaskOut>(`/api/v1/tasks/${taskId}/approve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useRejectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) =>
      api<TaskOut>(`/api/v1/tasks/${taskId}/reject`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export type WithdrawOut = {
  id: number;
  user_id: number;
  amount: string;
  wallet_address: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export function usePendingWithdrawals() {
  return useQuery({
    queryKey: ["withdraw", "pending"],
    queryFn: () => api<WithdrawOut[]>("/api/v1/withdraw/pending"),
  });
}

export function useReviewWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      approve,
      note,
    }: {
      id: number;
      approve: boolean;
      note?: string | null;
    }) =>
      api<WithdrawOut>(`/api/v1/withdraw/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ approve, note: note || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["withdraw"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useMyWithdrawals() {
  return useQuery({
    queryKey: ["withdraw", "mine"],
    queryFn: () => api<WithdrawOut[]>("/api/v1/withdraw/mine"),
  });
}
