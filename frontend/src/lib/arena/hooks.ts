import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { arenaApi, pollMs, type ApiPlan, type ArenaRoom } from "./api";

export const arenaKeys = {
  lobby: ["arena", "rooms"] as const,
  room: (id: number) => ["arena", "room", id] as const,
};

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
    queryFn: () => {
      const prev = qc.getQueryData<ArenaRoom>(arenaKeys.room(id));
      // since = ход перед текущим: в журнале всегда есть последний разыгранный ход (его события — в ленту)
      return prev?.status === "running" ? arenaApi.state(id, sinceOf(prev)) : arenaApi.room(id);
    },
    enabled: Number.isFinite(id) && id > 0,
    refetchInterval: (q) => pollMs(q.state.data),
    retry: false,
  });
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
