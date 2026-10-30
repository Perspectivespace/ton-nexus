export type MinerOut = {
  power: number;
  capacity: number;
  acceleration: number;
  luck: number;
  stability: number;
  status: string;
  pending_reward: string;
  estimated_reward?: string;
  storage_cap?: string;
  cycle_hours?: number;
  accrued_now?: string;
  session_started_at?: string | null;
  session_ends_at?: string | null;
  /** Цена следующей попытки усиления (TON). Нет у старого сервера во время выкладки. */
  upgrade_cost?: string;
  /** Ёмкость: прибавка к добыче за цикл, % (нет у старого сервера) */
  capacity_bonus_pct?: number;
  /** Удача: границы броска при сборе, % */
  luck_min_pct?: number;
  luck_max_pct?: number;
};

export type MeOut = {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  balance: string;
  xp: number;
  level: number;
  focus_tokens: number;
  block_tokens: number;
  success_boost_bp: number;
  is_ambassador: boolean;
  is_admin: boolean;
  is_owner: boolean;
  is_deployer: boolean;
  can_deploy: boolean;
  miner: MinerOut | null;
};

export type TaskOut = {
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
};

export type DeployStatus = "queued" | "running" | "success" | "failed";

export type DeployCommit = {
  sha: string;
  subject: string;
  author?: string | null;
  date?: string | null;
};

export type DeployJob = {
  id: string;
  target: string;
  force: boolean;
  status: DeployStatus;
  step?: string | null;
  steps_done?: string[];
  error?: string | null;
  warning?: string | null;
  requested_by?: number | null;
  requested_by_name?: string | null;
  requested_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  from_commit?: string | null;
  to_commit?: string | null;
  to_subject?: string | null;
  commits?: DeployCommit[];
  log_tail?: string;
};

export type DeployOverview = {
  target: string;
  runner_installed: boolean;
  deployed: {
    commit: string | null;
    subject: string | null;
    deployed_at: string | null;
    job_id?: string | null;
    head_matches?: boolean | null;
  };
  latest: { commit: string | null; sha: string; subject: string | null; date?: string | null } | null;
  ahead_by: number | null;
  pending: DeployCommit[];
  update_available: boolean | null;
  github_error: string | null;
  active: DeployJob | null;
  last: DeployJob | null;
  can_manage_deployers: boolean;
};

export type DeployerOut = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  /** из TELEGRAM_DEPLOYER_IDS на сервере — в приложении не снимается */
  from_env?: boolean;
};

// ── «Башня» ──
export type TowerStatus = {
  free_per_day: number;
  used_today: number;
  left_today: number;
  /** ближайшие 00:00 МСК (ISO, UTC) — когда вернутся попытки */
  next_reset_at: string;
  month: string;
  best_month: number | null;
  rank: number | null;
};

export type TowerLeaderEntry = { rank: number; name: string; score: number; is_me: boolean };

export type TowerPrize = { place: number; ton: string };

export type TowerLeaderboard = {
  /** «2026-10» */
  month: string;
  /** лучший счёт месяца каждого игрока; при равенстве выше тот, кто набрал раньше */
  entries: TowerLeaderEntry[];
  total_players: number;
  /** null — в этом месяце у меня нет результата */
  me: { rank: number | null; score: number | null } | null;
  /** 00:00 МСК 1-го числа следующего месяца (ISO, UTC) */
  month_ends_at: string;
  /** призы платятся, если в месяце не меньше стольких игроков */
  min_participants: number;
  /** null — призы выключены или не назначены (у прошлых месяцев всегда null) */
  prizes: TowerPrize[] | null;
};

export type TowerStart = {
  game_id: number;
  seed: number;
  booster: string | null;
  status: TowerStatus;
};

export type TowerFinish = {
  game_id: number;
  score: number;
  height: number;
  perfects: number;
  best_combo: number;
  over: boolean;
  new_best: boolean;
  best_month: number;
  rank: number | null;
  status: TowerStatus;
};
