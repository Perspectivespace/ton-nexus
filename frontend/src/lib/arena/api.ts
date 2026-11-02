import { api, ApiError } from "@/api/client";

/**
 * Клиент API «Арены» (backend/app/api/arena.py, префикс /api/v1/arena).
 * Суммы приходят строками в нано-TON; время — ISO UTC. К каждому ответу с server_time
 * добавляется skew — поправка часов клиента (мс), по ней считаются таймеры набора и отсчёта.
 */
export const ARENA = "/api/v1/arena";
export const NANO = 1_000_000_000;
/** отсчёт перед первым ходом и срок набора комнаты (RULES.md) */
export const COUNTDOWN_MS = 3000;
export const FILL_MS = 180_000;

export interface ArenaType {
  type: string;
  seats: number;
  board: number;
  stake_nano: string;
  prizes_nano: string[];
  pot_nano: string;
  commission_bps: number;
  waiting: number;
}
export interface ArenaLobby {
  types: ArenaType[];
  active_room_id: number | null;
  server_time: string;
  skew?: number;
}
export type RoomStatus = "waiting" | "running" | "finished" | "refunded" | "cancelled";
export interface ArenaSeat {
  seat: number;
  name: string;
  is_me: boolean;
}
export interface ArenaResult {
  seat: number;
  name: string;
  place: number;
  prize_nano: string;
}
export interface ArenaTurnInfo {
  turn: number;
  opens_at: string;
  deadline: string;
  ready_seats: number[];
  my_plan: unknown;
}
export interface ArenaMatchView {
  id: number;
  turn: number;
  /** countdown — до первого хода; planning — идёт ход; finished / cancelled — бой окончен */
  phase?: "countdown" | "planning" | "finished" | "cancelled";
  finished?: boolean;
  current?: ArenaTurnInfo | null;
  n?: number;
  players?: { seat: number; name?: string; hp?: number; alive?: boolean; is_me?: boolean }[];
}
export interface ArenaRoom {
  id: number;
  type: string;
  status: RoomStatus;
  seats_total: number;
  seats: (ArenaSeat | null)[];
  taken: number;
  my_seat: number | null;
  stake_nano: string;
  fill_deadline: string | null;
  started_at: string | null;
  finished_at: string | null;
  seed_hash: string | null;
  results: ArenaResult[];
  match: ArenaMatchView | null;
  server_time: string;
  skew?: number;
}
export interface ArenaLeave {
  ok: boolean;
  room_id: number;
  refunded_nano: string;
}

/** поправка часов: сервер − клиент в момент ответа */
export function skewOf(serverIso: string | undefined, now = Date.now()): number {
  const t = serverIso ? Date.parse(serverIso) : NaN;
  return Number.isFinite(t) ? t - now : 0;
}
const withSkew = <T extends { server_time: string }>(r: T): T & { skew: number } => ({ ...r, skew: skewOf(r.server_time) });

export const arenaApi = {
  rooms: () => api<ArenaLobby>(`${ARENA}/rooms`).then(withSkew),
  join: (type: string) => api<ArenaRoom>(`${ARENA}/join`, { method: "POST", body: JSON.stringify({ type }) }).then(withSkew),
  leave: () => api<ArenaLeave>(`${ARENA}/leave`, { method: "POST" }),
  room: (id: number) => api<ArenaRoom>(`${ARENA}/rooms/${id}`).then(withSkew),
  /** комната + бой; since — последний полученный ход (журнал ходов нужен экрану боя, здесь не берём лишнего) */
  state: (id: number, since = 0) => api<ArenaRoom>(`${ARENA}/rooms/${id}/state?since=${since}`).then(withSkew),
};

/** Ошибка API «Арены»: detail = {code, message[, room_id]} */
export interface ArenaErr {
  status: number;
  code: string;
  message: string;
  roomId?: number;
}

export function parseArenaError(e: unknown): ArenaErr {
  if (e instanceof ApiError) {
    try {
      const d = JSON.parse(e.message);
      if (d && typeof d === "object" && typeof d.code === "string") {
        const roomId = Number(d.room_id);
        return { status: e.status, code: d.code, message: String(d.message ?? ""), ...(Number.isFinite(roomId) && roomId > 0 ? { roomId } : {}) };
      }
    } catch {
      /* detail — обычная строка */
    }
    if (e.status === 402) return { status: 402, code: "insufficient_balance", message: e.message };
    return { status: e.status, code: "http_" + e.status, message: e.message };
  }
  return { status: 0, code: "network", message: "Нет связи с сервером" };
}

/** Понятный текст ошибки для экрана */
export function arenaErrorText(e: ArenaErr): string {
  switch (e.code) {
    case "insufficient_balance":
      return "Не хватает TON на балансе для ставки. Пополните баланс и возвращайтесь.";
    case "arena_disabled":
      return "«Арена» пока закрыта.";
    case "already_in_room":
      return "Вы уже в комнате — открываем её.";
    case "unknown_room_type":
      return "Такой комнаты нет. Обновите список.";
    case "not_joined":
      return "Вы уже не в комнате.";
    case "room_state":
      return "Комната уже собрана — выйти нельзя.";
    case "network":
      return "Нет связи с сервером. Попробуйте ещё раз.";
    default:
      return e.message || "Что-то пошло не так. Попробуйте ещё раз.";
  }
}

// ───── формат сумм ─────
/** нано-TON (строка или число) → TON: 100000000 → «0.1», 360000000 → «0.36» */
export function tonOf(nano: string | number | null | undefined): number {
  const n = typeof nano === "string" ? Number(nano) : (nano ?? 0);
  return Number.isFinite(n) ? n / NANO : 0;
}
export function fmtTon(nano: string | number | null | undefined, minDigits = 1): string {
  const v = Math.round(tonOf(nano) * 1e4) / 1e4;
  let s = v.toFixed(4).replace(/0+$/, "");
  const [i, f = ""] = s.split(".");
  s = `${i}.${f.padEnd(minDigits, "0")}`;
  return s.replace(/\.$/, "");
}
/** призы — минимум два знака: «0.36», «0.50» */
export const fmtPrize = (nano: string | number) => fmtTon(nano, 2);
export const commissionPct = (bps: number) => `${Math.round(bps) / 100}%`.replace(".0%", "%");

/** «Арена 4» / «Арена 8» */
export const roomName = (t: Pick<ArenaType, "seats">) => `Арена ${t.seats}`;

/** Деньги комнаты: фонд, комиссия, призы по местам */
export function money(t: ArenaType) {
  const pot = tonOf(t.pot_nano);
  const prizes = t.prizes_nano.map(tonOf);
  return { stake: tonOf(t.stake_nano), pot, fee: Math.round((pot * t.commission_bps) / 10000 * 1e4) / 1e4, prizes };
}

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ───── состояние экрана комнаты ─────
export type RoomScreen =
  | { kind: "waiting"; left: number; taken: number; seats: number }
  | { kind: "left" } // вышел из комнаты, она ещё набирается
  | { kind: "refunded" } // не набралась за 3 минуты — ставки вернулись
  | { kind: "cancelled" }
  | { kind: "countdown"; sec: number }
  | { kind: "battle"; turn: number }
  | { kind: "finished" };

/**
 * Что показать по виду комнаты и времени. nowMs — часы клиента; поправка skew берётся из ответа.
 * Отсчёт идёт до opens_at первого хода (started_at + 3 с), после него — бой (экран боя — следующий шаг).
 */
export function roomScreen(r: ArenaRoom, nowMs = Date.now()): RoomScreen {
  const now = nowMs + (r.skew ?? 0);
  switch (r.status) {
    case "refunded":
      return { kind: "refunded" };
    case "cancelled":
      return { kind: "cancelled" };
    case "finished":
      return { kind: "finished" };
    case "waiting": {
      if (r.my_seat == null) return { kind: "left" };
      const dl = r.fill_deadline ? Date.parse(r.fill_deadline) : NaN;
      return { kind: "waiting", left: Number.isFinite(dl) ? Math.max(0, dl - now) : FILL_MS, taken: r.taken, seats: r.seats_total };
    }
    case "running": {
      const m = r.match;
      if (m?.phase === "finished") return { kind: "finished" };
      if (m?.phase === "cancelled") return { kind: "cancelled" };
      const cur = m?.current;
      const opens = cur?.turn === 1 && cur.opens_at ? Date.parse(cur.opens_at) : r.started_at ? Date.parse(r.started_at) + COUNTDOWN_MS : NaN;
      const turnOne = !m || m.turn <= 1;
      if (turnOne && Number.isFinite(opens) && now < opens) return { kind: "countdown", sec: Math.min(3, Math.max(1, Math.ceil((opens - now) / 1000))) };
      return { kind: "battle", turn: cur?.turn ?? Math.max(1, m?.turn ?? 1) };
    }
  }
  return { kind: "finished" };
}

/** Комнаты, где таймер меняет экран без ответа сервера: набор, отсчёт */
export const ticking = (s: RoomScreen) => s.kind === "waiting" || s.kind === "countdown";

/** Опрос: ~1 с, пока комната живая; закрытая — не опрашиваем */
export const pollMs = (r: ArenaRoom | undefined) => (!r || r.status === "waiting" || r.status === "running" ? 1000 : false);

// ───── видимость карточки в «Играх» ─────
export interface ArenaCardIn {
  isOwner: boolean | undefined;
  /** значение настройки «arena» ({enabled}) — только у владельца */
  setting: unknown;
  /** GET /rooms для игрока: ok — открыта, err — закрыта (403 arena_disabled) или сбой */
  lobby: "ok" | "err" | "pending";
}
/** show — показывать карточку; test — бейдж «тест» (владелец видит выключенную «Арену») */
export function arenaCard({ isOwner, setting, lobby }: ArenaCardIn): { show: boolean; test: boolean } {
  if (isOwner) {
    const on = !!(setting && typeof setting === "object" && (setting as { enabled?: unknown }).enabled === true);
    return { show: true, test: !on };
  }
  return { show: lobby === "ok", test: false };
}
