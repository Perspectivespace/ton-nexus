import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  DeployJob,
  DeployOverview,
  DeployerOut,
  MeOut,
  MinerOut,
  TaskOut,
} from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeOut>("/api/v1/me"),
  });
}

export function useMiner(opts?: { fresh?: boolean }) {
  return useQuery({
    queryKey: ["miner"],
    queryFn: () => api<MinerOut>("/api/v1/miner"),
    // fresh — перезапросить при открытии экрана (цена прогона могла измениться в настройках экономики)
    ...(opts?.fresh ? { refetchOnMount: "always" as const } : {}),
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
    mutationFn: () => api<DailyClaim>("/api/v1/daily/claim", { method: "POST" }),
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
    // и после ошибки: цена и уровни на сервере могли измениться
    onSettled: () => {
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

export function useEconomySettings(enabled = true) {
  return useQuery({
    queryKey: ["economy"],
    queryFn: () => api<EconomySetting[]>("/api/v1/economy/settings"),
    enabled,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["economy"] });
      qc.invalidateQueries({ queryKey: ["miner"] }); // цена прогона зависит от настроек
    },
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

export type PromoRedeemOut = {
  code: string;
  reward_ton: string;
  reward_xp: number;
  reward_focus: number;
};

export function usePromoRedeem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<PromoRedeemOut>("/api/v1/promo/redeem", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export type PromoCreateOut = {
  id: number;
  code: string;
  is_active: boolean;
};

export function usePromoCreate() {
  return useMutation({
    mutationFn: (body: {
      code: string;
      reward_ton?: string | number;
      reward_xp?: number;
      reward_focus?: number;
      max_uses?: number | null;
    }) =>
      api<PromoCreateOut>("/api/v1/promo/create", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

export type TaskCreateBody = {
  title: string;
  description: string;
  reward: string | number;
  total_slots: number;
  task_type?: string;
  target_url?: string | null;
  min_level?: number;
  xp_reward?: number;
  publish?: boolean;
};

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskCreateBody) =>
      api<TaskDetail>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function usePublishTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) =>
      api<TaskOut>(`/api/v1/tasks/${taskId}/publish`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export type OwnerStats = {
  total_users: number;
  registrations_today: number;
};

export function useOwnerStats() {
  return useQuery({
    queryKey: ["owner", "stats"],
    queryFn: () => api<OwnerStats>("/api/v1/admin/stats"),
  });
}

export type PromoListItem = {
  id: number;
  code: string;
  reward_ton: string;
  reward_xp: number;
  reward_focus: number;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  created_at: string;
};

export function usePromoList() {
  return useQuery({
    queryKey: ["owner", "promos"],
    queryFn: () => api<PromoListItem[]>("/api/v1/promo/list"),
  });
}

/* ---------- Deploy (owner + deployers) ---------- */

const isLive = (j?: DeployJob | null) => j?.status === "queued" || j?.status === "running";

export function useDeployOverview(enabled = true) {
  return useQuery({
    queryKey: ["deploy", "overview"],
    queryFn: () => api<DeployOverview>("/api/v1/admin/deploy/overview?target=test"),
    enabled,
    refetchInterval: (q) => (isLive(q.state.data?.active) ? 3000 : 60000),
  });
}

export function useDeployJobs(enabled = true) {
  return useQuery({
    queryKey: ["deploy", "jobs"],
    queryFn: () => api<DeployJob[]>("/api/v1/admin/deploy/jobs?limit=10"),
    enabled,
  });
}

export function useDeployJob(id: string | null | undefined) {
  return useQuery({
    queryKey: ["deploy", "job", id],
    queryFn: () => api<DeployJob>(`/api/v1/admin/deploy/jobs/${id}?lines=120`),
    enabled: !!id,
    refetchInterval: (q) => (isLive(q.state.data) || !q.state.data ? 2000 : false),
  });
}

export function useDeployCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DeployOverview>("/api/v1/admin/deploy/overview?target=test&refresh=true"),
    onSuccess: (data) => qc.setQueryData(["deploy", "overview"], data),
  });
}

export function useDeployRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target: "test" | "prod"; force?: boolean }) =>
      api<DeployJob>("/api/v1/admin/deploy", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deploy"] }),
  });
}

export function useDeployers(enabled = true) {
  return useQuery({
    queryKey: ["deploy", "deployers"],
    queryFn: () => api<DeployerOut[]>("/api/v1/admin/deploy/deployers"),
    enabled,
  });
}

export function useSetDeployer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { telegram_id: number; is_deployer: boolean }) =>
      api("/api/v1/admin/roles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deploy", "deployers"] }),
  });
}
