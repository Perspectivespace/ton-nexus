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
