/**
 * Client side of world deletion: what the dialog shows, and how the app forgets a deleted world.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { WorldListItem } from "@/lib/dto";
import { deleteConfirmationPhrase } from "@/lib/validation/world";
import { api, ApiError, queryKeys, type DeleteWorldResponse } from "./api";

export const WORLDS_PATH = "/worlds";

/** What a deletion removes, in the words the dialog uses. */
export const DELETED_CONTENT = [
  "la mappa e tutte le celle",
  "persone, famiglie e dinastie",
  "tribù, insediamenti e civiltà",
  "tecnologie scoperte e relazioni diplomatiche",
  "eventi storici e cronaca",
  "statistiche e serie storiche",
  "snapshot e registro delle simulazioni",
] as const;

/** True when the typed text is exactly the expected phrase (the button stays disabled otherwise). */
export function confirmationMatches(worldName: string, typed: string): boolean {
  return typed === deleteConfirmationPhrase(worldName);
}

/** Removes every cached query of the world and drops it from the cached world list. */
export async function purgeWorldFromCache(queryClient: QueryClient, worldId: string) {
  const keys = [
    queryKeys.world(worldId),
    queryKeys.events(worldId),
    queryKeys.stats(worldId),
    ["person", worldId],
  ];
  await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  for (const queryKey of keys) queryClient.removeQueries({ queryKey });
  queryClient.setQueryData<WorldListItem[]>(queryKeys.worlds, (old) => old?.filter((w) => w.id !== worldId));
  await queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
}

/**
 * Pauses the world if needed, deletes it, and clears the cache. A world that is already gone
 * (404) counts as deleted: the goal of the request is reached either way.
 */
export async function deleteWorldFlow(
  queryClient: QueryClient,
  world: { id: string; name: string; status: "running" | "paused" },
  typed: string,
  client: Pick<typeof api, "deleteWorld" | "setStatus"> = api,
): Promise<DeleteWorldResponse | null> {
  if (world.status === "running") await client.setStatus(world.id, "paused");
  let result: DeleteWorldResponse | null = null;
  try {
    result = await client.deleteWorld(world.id, { confirmation: typed, worldName: world.name });
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "NOT_FOUND")) throw error;
  }
  await purgeWorldFromCache(queryClient, world.id);
  return result;
}

/** User-facing message for a failed deletion. */
export function deletionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "CONFIRMATION_MISMATCH":
        return "Il testo di conferma non corrisponde: nessun dato è stato eliminato.";
      case "WORLD_RUNNING":
        return "Il mondo è ancora in esecuzione: mettilo in pausa e riprova.";
      case "SIMULATION_IN_PROGRESS":
        return "È in corso una simulazione su questo mondo: attendi qualche secondo e riprova.";
      case "FORBIDDEN":
        return "Non sei autorizzato a eliminare questo mondo.";
      default:
        return error.message;
    }
  }
  return "Eliminazione non riuscita. Riprova.";
}
