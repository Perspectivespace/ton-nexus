import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiBlob, apiUpload } from "./client";
import { setServerClock } from "@/lib/cityPhase";
import type {
  DeployJob,
  DeployOverview,
  DeployerOut,
  StaffOut,
  UserSearchRow,
  MeOut,
  MinerOut,
  TaskOut,
  TowerFinish,
  TowerStart,
  TowerStatus,
  TowerLeaderboard,
  TowerPrizesAdmin,
  RatingBoard,
  RatingKind,
  RatingPeriod,
  RatingSummary,
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
    // fresh — перезапросить при открытии экрана (цена попытки могла измениться в настройках экономики)
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
  /** когда снова можно отметиться (00:00 МСК); null — можно сейчас. Нет у старого сервера. */
  next_claim_at?: string | null;
  /** часы сервера — поправка для отсчёта */
  server_time?: string;
  /** день 7-дневного круга «сегодня» (1..7): уже полученный или тот, что даст следующая отметка */
  cycle_day?: number;
  /** награды всех 7 дней круга. Нет у старого сервера — полоса не показывается. */
  rewards?: DailyDay[];
};

export type DailyDay = { day: number; ton: string; xp: number; focus: number };

export type DailyClaim = {
  already_claimed: boolean;
  streak: number;
  cycle_day?: number;
  reward_ton: string;
  reward_xp: number;
  reward_focus: number;
  check_date: string;
  next_claim_at?: string;
};

export function useDailyStatus() {
  return useQuery({
    queryKey: ["daily"],
    queryFn: () => api<DailyStatus>("/api/v1/daily/status"),
  });
}

export type WheelSector = {
  id: string;
  label: string;
  weight: number;
  /** шанс сектора в процентах, из весов в настройках владельца */
  chance_pct: number;
};

export type WheelStatus = {
  free_spins_per_day: number;
  used_today: number;
  left_today: number;
  /** нет у старого сервера — тогда шансы не показываем */
  sectors?: WheelSector[];
  /** "default" — в настройках все веса 0 или некорректны, действуют запасные */
  weights_source?: "settings" | "default";
  /** когда появятся новые бесплатные вращения (00:00 МСК) */
  next_reset_at?: string | null;
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
  commission_bp?: number | null;
  partner_user_id?: number | null;
  partner_name?: string | null;
  purchased?: boolean | null;
  proof_required?: boolean;
};

export type PurchaseOut = {
  purchase_id: number;
  task_id: number;
  already: boolean;
  amount: string;
  fee: string;
  partner_gets: string;
  xp: number;
  balance: string;
};

/** Покупка партнёрской услуги с баланса; повтор возвращает ту же покупку (already) */
export function useTaskBuy(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PurchaseOut>(`/api/v1/tasks/${taskId}/buy`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    },
  });
}

export function useTaskClose(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<TaskDetail>(`/api/v1/tasks/${taskId}/close`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export type SubmissionOut = {
  id: number;
  task_id: number;
  user_id: number;
  status: string;
  proof_text: string | null;
  proof_url: string | null;
  review_note: string | null;
  proof_image_id?: number | null;
  proof_image_state?: "available" | "deleted" | null;
  proof_delete_after?: string | null;
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
    mutationFn: (body: { proof_text?: string | null; proof_url?: string | null; proof_upload_id?: number | null }) =>
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

export type ProofUploadOut = { id: number; mime: string; size: number };

/** Скриншот выполнения: сырые байты картинки → id загрузки для /submit */
export function useProofUpload(taskId: number) {
  return useMutation({
    mutationFn: (file: Blob) => apiUpload<ProofUploadOut>(`/api/v1/tasks/${taskId}/proof-upload`, file),
  });
}

/** Скриншот заявки для проверяющего: blob → object URL (освобождается при размонтировании) */
export function useProofImage(proofId: number | null | undefined) {
  const q = useQuery({
    queryKey: ["proof-image", proofId],
    queryFn: () => apiBlob(`/api/v1/tasks/proofs/${proofId}/image`),
    enabled: proofId != null,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  return { url, isLoading: q.isLoading, error: q.error };
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
      qc.invalidateQueries({ queryKey: ["miner"] }); // цена попытки зависит от настроек
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
  proof_image_id?: number | null;
  proof_image_state?: "available" | "deleted" | null;
  proof_delete_after?: string | null;
};

export function usePendingSubmissions(enabled = true, refetchInterval?: number) {
  return useQuery({
    refetchInterval,
    queryKey: ["inbox", "submissions"],
    enabled,
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

export function usePendingTaskApprovals(enabled = true, refetchInterval?: number) {
  return useQuery({
    refetchInterval,
    queryKey: ["inbox", "task-approvals"],
    enabled,
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
  /** выплата: payload выдан (status «sending»), хеш исходящего перевода (hex), когда подтверждена */
  payout_started_at?: string | null;
  tx_hash?: string | null;
  paid_at?: string | null;
  user_telegram_id?: number | null;
  username?: string | null;
  first_name?: string | null;
};

export type PayoutConfig = {
  enabled: boolean;
  payout_wallet: string;
  payout_wallet_raw: string | null;
  network: string;
  is_owner: boolean;
};

/** Кошелёк выплат (настройка «Выплаты TON») — Касса сверяет с ним подключённый кошелёк */
export function usePayoutConfig(enabled = true) {
  return useQuery({
    queryKey: ["withdraw", "payout-config"],
    enabled,
    queryFn: () => api<PayoutConfig>("/api/v1/withdraw/payout-config"),
    staleTime: 60_000,
  });
}

function useWithdrawMutation<V>(fn: (v: V) => Promise<WithdrawOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["withdraw"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** «Проверить»: сервер ищет перевод заявки среди исходящих кошелька выплат */
export function useCheckPayout() {
  return useWithdrawMutation((id: number) => api<WithdrawOut>(`/api/v1/withdraw/${id}/check`, { method: "POST" }));
}

/** Запасной путь: хеш перевода, сервер проверяет его через toncenter */
export function useVerifyPayoutHash() {
  return useWithdrawMutation(({ id, txHash }: { id: number; txHash: string }) =>
    api<WithdrawOut>(`/api/v1/withdraw/${id}/verify-hash`, { method: "POST", body: JSON.stringify({ tx_hash: txHash }) }),
  );
}

export function usePendingWithdrawals(enabled = true, refetchInterval?: number) {
  return useQuery({
    refetchInterval,
    queryKey: ["withdraw", "pending"],
    enabled,
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
      unverified = false,
    }: {
      id: number;
      approve: boolean;
      note?: string | null;
      /** approve без доказательства перевода — только владелец, с заметкой */
      unverified?: boolean;
    }) =>
      api<WithdrawOut>(`/api/v1/withdraw/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ approve, note: note || null, unverified }),
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

export type WithdrawLimits = { min_ton: string };

/** Условия вывода (минимум). Старый сервер без адреса — null, форма тогда не знает минимума. */
export function useWithdrawLimits() {
  return useQuery({
    queryKey: ["withdraw", "limits"],
    queryFn: () => api<WithdrawLimits>("/api/v1/withdraw/limits"),
    retry: false,
    staleTime: 5 * 60_000,
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
  reward?: string | number | null;
  total_slots: number;
  task_type?: string;
  target_url?: string | null;
  min_level?: number;
  xp_reward?: number | null;
  publish?: boolean;
  commission_bp?: number | null;
  partner_telegram_id?: number | null;
  proof_required?: boolean;
};

export type TaskQuote = {
  task_type: string;
  reward: string;
  xp: number;
  payout: string;
  commission: string;
  total: string;
  commission_bp: number;
  slots: number;
};

export type TaskQuoteReq = {
  task_type: "visit" | "campaign" | "partner";
  total_slots: number;
  reward?: string;
  commission_bp?: number | null;
};

function quoteReqValid(r: TaskQuoteReq | null): r is TaskQuoteReq {
  if (!r || !(r.total_slots >= 1 && r.total_slots <= 10000)) return false;
  if (r.task_type === "campaign" || r.task_type === "partner") return !!r.reward && Number(r.reward) > 0;
  return true;
}

/** Живая цена (visit по тарифу, campaign с ручной наградой): debounce 250 мс */
export function useTaskQuote(req: TaskQuoteReq | null) {
  const key = req ? JSON.stringify(req) : null;
  const [debounced, setDebounced] = useState<string | null>(key);
  useEffect(() => {
    if (key == null) {
      setDebounced(null);
      return;
    }
    const t = window.setTimeout(() => setDebounced(key), 250);
    return () => window.clearTimeout(t);
  }, [key]);
  const parsed: TaskQuoteReq | null = debounced ? JSON.parse(debounced) : null;
  return useQuery({
    queryKey: ["tasks", "quote", debounced],
    enabled: quoteReqValid(parsed),
    queryFn: () =>
      api<TaskQuote>("/api/v1/tasks/quote", {
        method: "POST",
        body: debounced!,
      }),
    staleTime: 15_000,
    retry: false,
  });
}

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

/* ---------- Роли: владельцы и админы ---------- */

export function useRolesStaff(enabled = true) {
  return useQuery({
    queryKey: ["roles", "staff"],
    queryFn: () => api<StaffOut>("/api/v1/admin/roles/staff"),
    enabled,
  });
}

/** Поиск по @username (начало) или точному Telegram ID; пустой запрос не уходит на сервер */
export function useUserSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ["roles", "search", query],
    queryFn: () => api<UserSearchRow[]>(`/api/v1/admin/users/search?q=${encodeURIComponent(query)}`),
    enabled: query.replace(/^@/, "").length > 0,
    staleTime: 15000,
  });
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { telegram_id: number; is_admin?: boolean; is_owner?: boolean }) =>
      api("/api/v1/admin/roles", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ── «Башня» ──
export function useTowerMe() {
  return useQuery({
    queryKey: ["tower", "me"],
    queryFn: async () => {
      const r = await api<TowerStatus>("/api/v1/tower/me");
      setServerClock(r.server_time);
      return r;
    },
    // попытки могли смениться (полночь по Москве, игра с другого устройства) — смотрим заново при каждом открытии
    refetchOnMount: "always",
  });
}

/** сколько мест показывает экран топа (сервер отдаёт до 100) */
export const TOWER_TOP_LIMIT = 50;

/** Топ месяца; `month` — «ГГГГ-ММ», без него — текущий месяц по Москве */
export function useTowerLeaderboard(month?: string, limit = TOWER_TOP_LIMIT) {
  return useQuery({
    queryKey: ["tower", "leaderboard", month ?? "current", limit],
    queryFn: async () => {
      const r = await api<TowerLeaderboard>(
        `/api/v1/tower/leaderboard?limit=${limit}${month ? `&month=${encodeURIComponent(month)}` : ""}`,
      );
      setServerClock(r.server_time);
      return r;
    },
    staleTime: 30_000,
  });
}

/** «Мои места»: место в каждом топе (Профиль, ссылка «Топ исполнителей» в Заработке) */
export function useRatingSummary() {
  return useQuery({
    queryKey: ["ratings", "summary"],
    queryFn: () => api<RatingSummary>("/api/v1/ratings/summary"),
    staleTime: 60_000,
  });
}

/** Топ по уровню / заданиям / друзьям; без `period` сервер берёт период по умолчанию для топа */
export function useRating(kind: RatingKind, period?: RatingPeriod) {
  return useQuery({
    queryKey: ["ratings", kind, period ?? "default"],
    queryFn: async () => {
      const r = await api<RatingBoard>(`/api/v1/ratings/${kind}?limit=50${period ? `&period=${period}` : ""}`);
      setServerClock(r.server_time);
      return r;
    },
    staleTime: 60_000,
  });
}

/** «Призы Башни» в Кассе — только владельцу */
export function useTowerPrizesAdmin(enabled: boolean) {
  return useQuery({
    queryKey: ["tower", "prizes-admin"],
    queryFn: () => api<TowerPrizesAdmin>("/api/v1/tower/admin/prizes"),
    enabled,
  });
}

export type TowerPrizeAction =
  | { kind: "close"; month?: string }
  | { kind: "pay" | "void" | "approve"; id: number }
  | { kind: "pay-all"; monthId: number };

function prizeActionPath(a: TowerPrizeAction): string {
  const base = "/api/v1/tower/admin/prizes";
  if (a.kind === "close") return `${base}/close`;
  if (a.kind === "pay-all") return `${base}/months/${a.monthId}/pay-all`;
  return `${base}/results/${a.id}/${a.kind}`;
}

/** Закрыть месяц / выплатить / аннулировать / одобрить: сервер отвечает свежим списком */
export function useTowerPrizeAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: TowerPrizeAction) =>
      api<TowerPrizesAdmin>(prizeActionPath(a), {
        method: "POST",
        body: JSON.stringify(a.kind === "close" ? { month: a.month ?? null } : {}),
      }),
    onSuccess: (r) => {
      qc.setQueryData(["tower", "prizes-admin"], r);
      // статусы призов на вкладке «Прошлый» поменялись
      void qc.invalidateQueries({ queryKey: ["tower", "leaderboard"] });
    },
  });
}

export function useTowerStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<TowerStart>("/api/v1/tower/start", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (r) => qc.setQueryData(["tower", "me"], r.status),
    // 409 «попыток нет» — подтянуть актуальный статус, экран покажет сообщение
    onError: () => qc.invalidateQueries({ queryKey: ["tower", "me"] }),
  });
}

export function useTowerFinish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { game_id: number; taps: number[]; score: number }) =>
      api<TowerFinish>("/api/v1/tower/finish", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (r) => {
      qc.setQueryData(["tower", "me"], r.status);
      // новый рекорд мог сдвинуть место в топе
      if (r.new_best) void qc.invalidateQueries({ queryKey: ["tower", "leaderboard"] });
    },
  });
}

export type WalletInfo = {
  enabled: boolean;
  network: string;
  wallet: { address: string; wallet_app: string | null; linked_at: string } | null;
};

export function useWallet() {
  return useQuery({
    queryKey: ["wallet"],
    queryFn: () => api<WalletInfo>("/api/v1/wallet"),
  });
}

export function useWalletLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api("/api/v1/wallet/link", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet"] }),
  });
}

export function useWalletUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/v1/wallet/unlink", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet"] }),
  });
}


export type DepositInfo = {
  enabled: boolean;
  project_address: string;
  memo: string;
  min_ton: string;
  network: string;
};

export function useDepositInfo() {
  return useQuery({
    queryKey: ["deposits", "info"],
    queryFn: () => api<DepositInfo>("/api/v1/deposits/info"),
  });
}

export function useMyDeposits() {
  return useQuery({
    queryKey: ["deposits", "mine"],
    queryFn: () => api<{ id: number; amount_ton: string; status: string; created_at: string }[]>("/api/v1/deposits/mine"),
  });
}

export type AdminDeposit = {
  id: number;
  tx_hash: string;
  amount_ton: string;
  status: "unmatched" | "below_min" | "credited" | "manual" | "ignored";
  memo: string | null;
  comment: string | null;
  from_address: string | null;
  user_id: number | null;
  utime: number | null;
  created_at: string;
};

/** Касса → «Пополнения»: незачисленные переводы (без мемо или меньше минимума) */
export function useAdminDeposits(enabled = true) {
  return useQuery({
    queryKey: ["deposits", "admin"],
    queryFn: () => api<AdminDeposit[]>("/api/v1/deposits"),
    enabled,
  });
}

/** Зачислить перевод вручную (только владелец) — через balance.credit на сервере */
export function useAssignDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, telegram_id, note }: { id: number; telegram_id: number; note?: string | null }) =>
      api<{ id: number; status: string; amount_ton: string }>(`/api/v1/deposits/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ telegram_id, note: note || null }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deposits", "admin"] }),
  });
}

/** История баланса (GET /balance/history): журнал balance_history с видом операции и статусом вывода */
export type HistoryFilter = "all" | "deposits" | "withdrawals" | "earnings" | "spending";

export type HistoryItem = {
  id: number | string;
  kind: string;
  group: "deposits" | "withdrawals" | "earnings" | "spending";
  label: string;
  detail: string | null;
  /** со знаком: «-1.5» — списание */
  amount: string;
  balance_after: string | null;
  created_at: string;
  status: string | null;
  status_label: string | null;
  /** выплаченный вывод: ссылка на перевод в tonviewer */
  tx_url?: string | null;
};

export type HistoryPage = { items: HistoryItem[]; next_cursor: number | null; pending: HistoryItem[] };

export const historyUrl = (filter: HistoryFilter, cursor?: number | null, limit = 30) =>
  `/api/v1/balance/history?filter=${filter}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`;

export function useBalanceHistory(filter: HistoryFilter) {
  return useInfiniteQuery({
    queryKey: ["balance", "history", filter],
    queryFn: ({ pageParam }) => api<HistoryPage>(historyUrl(filter, pageParam)),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

/** Последние операции для экрана «Кошелёк» */
export function useRecentHistory(limit = 3) {
  return useQuery({
    queryKey: ["balance", "recent", limit],
    queryFn: () => api<HistoryPage>(historyUrl("all", null, limit)),
  });
}

// ── Управление заданиями (владелец) ──────────────────────────────────────────

export type OwnerAction = {
  id: number;
  action: string;
  mode: string | null;
  actor_id: number | null;
  creator_delta: string;
  platform_delta: string;
  details: string | null;
  created_at: string | null;
};

export type OwnerTaskSummary = {
  task: TaskDetail;
  pending: number;
  paid_out: string;
  creator_payout: string;
  creator_commission: string;
  platform_payout: string;
  charged: string;
  refundable: string;
  commission_bp: number;
  log: OwnerAction[];
};

export type ManageOut = {
  task: TaskDetail;
  already: boolean;
  creator_delta: string;
  platform_delta: string;
  note: string | null;
};

export function useOwnerTaskSummary(taskId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["task", taskId, "owner"],
    queryFn: () => api<OwnerTaskSummary>(`/api/v1/tasks/${taskId}/owner`),
    enabled: enabled && taskId > 0,
  });
}

export function useOwnerTasks(status: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["tasks", "owner", status],
    queryFn: () =>
      api<TaskDetail[]>(`/api/v1/tasks/owner/all${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    enabled,
  });
}

function useOwnerTaskMutation<B>(taskId: number, path: string, method = "POST") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: B) =>
      api<ManageOut>(`/api/v1/tasks/${taskId}/${path}`, {
        method,
        body: body == null ? undefined : JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    },
  });
}

export const useOwnerCancel = (taskId: number) => useOwnerTaskMutation<null>(taskId, "owner/cancel");
export const useOwnerAddSlots = (taskId: number) =>
  useOwnerTaskMutation<{ count: number; mode: "charge" | "free" }>(taskId, "owner/add-slots");
export const useOwnerPrice = (taskId: number) =>
  useOwnerTaskMutation<{ reward: string; mode: "creator" | "absorb" }>(taskId, "owner/price");

export type TaskPatch = {
  title?: string;
  description?: string;
  target_url?: string | null;
  xp_reward?: number;
};

export function useTaskUpdate(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskPatch) =>
      api<TaskDetail>(`/api/v1/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}


// ── Реклама в городе: витрина на сегодня и события «Прогулки» ─────────────────

export type CityAdPalette = "cyan" | "magenta" | "amber" | "mint" | "violet";
export type CityAdOnBoard = {
  id: number;
  title: string;
  subtitle: string | null;
  body: string | null;
  link_url: string | null;
  link_kind: "telegram" | "web" | null;
  color: CityAdPalette | string;
  until: string;
};
export type CityAdSpotOnBoard = {
  key: string;
  format: "line" | "banner" | "neon";
  title: string;
  on_sale: boolean;
  price_day: string | null;
  ad: CityAdOnBoard | null;
};
export type CityAdsBoard = { day: string; spots: CityAdSpotOnBoard[]; palette: Record<string, string> };

/** Публичная витрина GET /api/v1/city-ads: одобренные объявления на сегодня (МСК). */
export function useCityAds() {
  return useQuery({
    queryKey: ["city-ads"],
    queryFn: () => api<CityAdsBoard>("/api/v1/city-ads"),
    staleTime: 60_000,
    retry: 0,
  });
}

export type CityAdEventKind = "impression" | "open" | "click";
const sentEvents = new Set<string>();

/** Событие «Прогулки» (сервер считает раз в сутки на человека); в пределах сессии повтор не отправляется. */
export function sendCityAdEvent(adId: number, kind: CityAdEventKind, day: string) {
  const key = `${day}:${adId}:${kind}`;
  if (sentEvents.has(key)) return;
  sentEvents.add(key);
  void api(`/api/v1/city-ads/${adId}/events`, { method: "POST", body: JSON.stringify({ kind }) }).catch(() => {
    sentEvents.delete(key); // не дошло — можно повторить позже
  });
}
