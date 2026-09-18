"use client";

import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/client/api";

/** How many years of battles the map shows as recent fighting. */
export const RECENT_BATTLE_YEARS = 25;

/**
 * Recent battle events (with their real map coordinates and casualties), shared by the map and
 * the war panel. The key lives under `events`, so it refreshes after every simulation batch.
 */
export function useMapBattles(worldId: string, year: number) {
  const fromYear = year - RECENT_BATTLE_YEARS;
  return useQuery({
    queryKey: [...queryKeys.events(worldId), "map-battles", fromYear],
    queryFn: () => api.events(worldId, { page: 1, pageSize: 100, type: "battle", fromYear }),
    staleTime: 30_000,
  });
}
