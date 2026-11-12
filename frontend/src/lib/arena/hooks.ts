import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { arenaApi, pollMs, type ApiPlan, type ArenaRoom } from "./api";

export const arenaKeys = {
  lobby: ["arena", "rooms"] as const,
  room: (id: number) => ["arena", "room", id] as const,
  history: ["arena", "history"] as const,
};

/** История моих боёв: страницы по 20, «Показать ещё» — before = id последней комнаты */
export function useArenaHistory() {
  return useInfiniteQuery({
    queryKey: arenaKeys.history,
    queryFn: ({ pageParam }) => arenaApi.history(pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before,
    refetchOnMount: "always",
    retry: false,
  });
}

/** Лобби: типы комнат, сколько ждут, моя активная комната. Опрос ~1 с, пока экран открыт. */
export function useArenaLobby(opts: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: arenaKeys.lobby,
    queryFn: arenaApi.rooms,
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll ? 1000 : false,
    refetchOnMount: "always",
    retry: false,
  });
}

/**
 * Комната: во время набора — GET /rooms/{id}, после старта — /state (фаза боя и окно хода).
 * Опрос ~1 с, пока комната живая (waiting / running); закрытая — один раз.
 */
export function useArenaRoom(id: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: arenaKeys.room(id),
    queryFn: () => fetchArenaRoom(id, qc.getQueryData<ArenaRoom>(arenaKeys.room(id))),
    enabled: Number.isFinite(id) && id > 0,
    refetchInterval: (q) => pollMs(q.state.data),
    retry: false,
  });
}

/**
 * Один шаг опроса комнаты. since = ход перед текущим: в журнале всегда есть последний разыгранный ход (его события — в ленту).
 * GET /rooms/{id} отдаёт бой без поля ({id, turn}) — увидев старт, сразу берём /state, не дожидаясь следующего опроса.
 */
export async function fetchArenaRoom(id: number, prev: ArenaRoom | undefined): Promise<ArenaRoom> {
  if (prev?.status === "running") return arenaApi.state(id, sinceOf(prev));
  const r = await arenaApi.room(id);
  return r.status === "running" ? arenaApi.state(id, sinceOf(r)) : r;
}

/** since для /state: последний разыгранный ход = текущий − 1 (журнал отдаёт ходы > since) */
export const sinceOf = (r: ArenaRoom | undefined) => Math.max(0, (r?.match?.turn ?? 1) - 2);

/** План хода: POST /rooms/{id}/plan. После «Готово» — сразу свежее состояние (ход мог разыграться) */
export function useArenaPlan(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { turn: number; plan: ApiPlan | null; ready: boolean }) => arenaApi.plan(id, v.turn, v.plan, v.ready),
    onSuccess: (r) => {
      if (r.ready || r.resolved) void qc.invalidateQueries({ queryKey: arenaKeys.room(id) });
    },
  });
}

export function useArenaJoin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => arenaApi.join(type),
    onSuccess: (room) => {
      qc.setQueryData(arenaKeys.room(room.id), room);
      // последний вошедший запускает бой: ответ входа — без поля, состояние боя — сразу через /state
      if (room.status === "running") void qc.invalidateQueries({ queryKey: arenaKeys.room(room.id) });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: arenaKeys.lobby });
    },
  });
}

export function useArenaLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => arenaApi.leave(),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: arenaKeys.room(r.room_id) });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: arenaKeys.lobby });
    },
  });
}

/** Часы для таймеров набора и отсчёта: тик 250 мс только пока on (экран ожидания / отсчёта) */
export function useNow(on: boolean, step = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), step);
    return () => window.clearInterval(t);
  }, [on, step]);
  return now;
}
