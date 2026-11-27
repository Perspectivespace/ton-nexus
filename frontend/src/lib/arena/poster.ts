/**
 * Афиша Арены (PR 5): живое состояние табло и входа по данным GET /arena/rooms.
 * Чистая функция — виды «открыта / очередь / закрыта»; турниры и сезонные события
 * можно добавить новым kind, не меняя вызов на улице.
 */
import type { ArenaLobby, ArenaType } from "./api";

export type ArenaPosterKind = "open" | "queue" | "closed";

export interface ArenaPosterModel {
  kind: ArenaPosterKind;
  waiting: number;
  /** ближайшая ставка среди открытых наборов, иначе среди всех типов */
  stakeNano: string | null;
  /** типы комнат, в которых сейчас кто-то ждёт */
  roomsOpen: number;
}

export interface ArenaPosterIn {
  lobby?: ArenaLobby | null;
  /** ok — ответ получен; err — 403/404/сеть; pending — ещё грузим */
  status: "ok" | "err" | "pending";
}

const stakeOf = (types: ArenaType[]): string | null => {
  if (!types.length) return null;
  return types.reduce((m, x) => (BigInt(x.stake_nano) < BigInt(m) ? x.stake_nano : m), types[0].stake_nano);
};

export function arenaPosterModel({ lobby, status }: ArenaPosterIn): ArenaPosterModel {
  if (status === "err") return { kind: "closed", waiting: 0, stakeNano: null, roomsOpen: 0 };
  const types = lobby?.types ?? [];
  const waiting = types.reduce((n, x) => n + x.waiting, 0);
  const roomsOpen = types.filter((x) => x.waiting > 0).length;
  const stakeNano = stakeOf(types.filter((x) => x.waiting > 0)) ?? stakeOf(types);
  // пока ответа нет — спокойная «открыта», без выдуманной очереди и без вспышки ошибки
  if (status === "pending" && !lobby) return { kind: "open", waiting: 0, stakeNano: null, roomsOpen: 0 };
  return { kind: waiting > 0 ? "queue" : "open", waiting, stakeNano, roomsOpen };
}
