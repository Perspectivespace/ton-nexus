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
  /** часы сервера (ISO) — отсчёты «Башни» идут по ним */
  server_time?: string;
};

/** статус приза закрытого месяца для игроков: выплачен · ждёт выплаты (в т. ч. на проверке) · аннулирован */
export type TowerPrizeStatus = "paid" | "awaiting" | "voided";

export type TowerLeaderEntry = {
  rank: number;
  name: string;
  score: number;
  is_me: boolean;
  /** только у закрытого месяца и только у призового места */
  prize_ton?: string;
  prize_status?: TowerPrizeStatus;
};

/** места с from_place по to_place (одно место — равны); каждому — ton */
export type TowerPrize = { from_place: number; to_place: number; ton: string };

export type TowerLeaderboard = {
  /** «2026-10» */
  month: string;
  /** лучший счёт месяца каждого игрока; при равенстве выше тот, кто набрал раньше */
  entries: TowerLeaderEntry[];
  total_players: number;
  /** null — в этом месяце у меня нет результата */
  me: { rank: number | null; score: number | null; prize_ton?: string; prize_status?: TowerPrizeStatus } | null;
  /** часы сервера (ISO) — по ним идёт отсчёт до итогов */
  server_time?: string;
  /** месяц закрыт: места и призы — из замороженных итогов */
  closed?: boolean;
  /** почему призов не было: disabled · few_participants · no_budget · no_players */
  close_reason?: string | null;
  /** сколько TON уже выплачено по итогам месяца */
  prize_paid_ton?: string | null;
  /** сколько TON ещё ждёт выплаты (вместе с призами на проверке) */
  prize_awaiting_ton?: string | null;
  /** 00:00 МСК 1-го числа следующего месяца (ISO, UTC) */
  month_ends_at: string;
  /** призы платятся, если в месяце не меньше стольких игроков */
  min_participants: number;
  /** участник для призов — лучший счёт не меньше min_score */
  min_score?: number;
  participants?: number;
  /** месячный бюджет призов (TON); null — призы выключены (у прошлых месяцев всегда null) */
  prize_budget_ton?: string | null;
  /** призовых мест сейчас (0 — ниже минимума или выключено) */
  prize_places?: number;
  /** при каком числе участников добавится призовое место; null — уже максимум */
  next_place_at?: number | null;
  max_places?: number;
  /** почему мест не больше: "budget" — бюджет не даёт мин. приз, "max" — потолок мест */
  prize_limited_by?: "budget" | "max" | null;
  min_prize_ton?: string | null;
  prize_total_ton?: string | null;
  /** счёт последнего призового места */
  prize_cutoff_score?: number | null;
  /** группы мест → TON по текущему числу участников (сумма ≤ бюджета); [] — ниже минимума; null — выключено */
  prizes: TowerPrize[] | null;
};

// ── «Призы Башни» (только владелец) ──
/** pending — ждёт выплаты · paid · flagged — повторная проверка забега не сошлась · voided — аннулирован */
export type TowerPrizeRowStatus = "pending" | "paid" | "flagged" | "voided";

export type TowerPrizeResult = {
  id: number;
  place: number;
  user_id: number;
  name: string;
  username: string | null;
  score: number;
  game_id: number | null;
  booster: string | null;
  amount_ton: string;
  status: TowerPrizeRowStatus;
  /** replay_mismatch, no_game, banned, owner, approved:… */
  note: string | null;
  paid_at: string | null;
  banned: boolean;
};

export type TowerPrizeMonth = {
  id: number;
  month: string;
  /** no_prizes · payout (есть нерешённые) · settled */
  status: "no_prizes" | "payout" | "settled";
  reason: string | null;
  total_players: number;
  participants: number;
  min_participants: number | null;
  places: number;
  budget_ton: string;
  planned_ton: string;
  paid_ton: string;
  pending_ton: string;
  closed_at: string;
  closed_auto: boolean;
  counts: { pending: number; paid: number; flagged: number; voided: number };
  results: TowerPrizeResult[];
};

export type TowerPrizesAdmin = {
  months: TowerPrizeMonth[];
  /** прошедшие месяцы с игроками без итогов («2026-10») */
  unclosed: string[];
  server_time: string;
  done?: Record<string, number | string> | null;
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
