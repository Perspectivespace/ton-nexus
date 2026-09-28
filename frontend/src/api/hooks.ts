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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
