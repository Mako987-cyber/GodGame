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

type DeletionClient = Pick<typeof api, "deleteWorld" | "setStatus"> &
  Partial<Pick<typeof api, "resumeDeletion">>;

export interface DeletionFlowOptions {
  /** Called with every intermediate state while a large world is purged in several steps. */
  onProgress?: (state: DeleteWorldResponse) => void;
  /** Waits between two polls (injectable in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Upper bound of polls before giving up (the server keeps the world hidden and resumable). */
  maxPolls?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls a confirmed deletion until it completes. */
async function pollDeletion(
  worldId: string,
  first: DeleteWorldResponse,
  client: DeletionClient,
  options: DeletionFlowOptions,
): Promise<DeleteWorldResponse> {
  let state = first;
  const sleep = options.sleep ?? defaultSleep;
  for (let i = 0; state.completed === false; i++) {
    if (!client.resumeDeletion || i >= (options.maxPolls ?? 600))
      throw new ApiError(
        "DELETION_PENDING",
        "L'eliminazione è ancora in corso: il mondo resta nascosto e verrà completata riaprendo la lista dei mondi.",
        202,
      );
    options.onProgress?.(state);
    await sleep(state.retryAfterMs ?? 1000);
    state = await client.resumeDeletion(worldId);
  }
  return state;
}

/**
 * Pauses the world if needed, deletes it (polling while a large world is purged in several
 * steps), and clears the cache. A world that is already gone (404) counts as deleted: the goal
 * of the request is reached either way.
 */
export async function deleteWorldFlow(
  queryClient: QueryClient,
  world: { id: string; name: string; status: "running" | "paused" | "deleting" },
  typed: string,
  client: DeletionClient = api,
  options: DeletionFlowOptions = {},
): Promise<DeleteWorldResponse | null> {
  if (world.status === "running") await client.setStatus(world.id, "paused");
  let result: DeleteWorldResponse | null = null;
  try {
    result = await client.deleteWorld(world.id, { confirmation: typed, worldName: world.name });
    result = await pollDeletion(world.id, result, client, options);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "NOT_FOUND")) throw error;
  }
  await purgeWorldFromCache(queryClient, world.id);
  return result;
}

/** Resumes a deletion confirmed earlier (world listed as "deleting"): no confirmation needed. */
export async function resumeDeletionFlow(
  queryClient: QueryClient,
  worldId: string,
  client: Pick<typeof api, "resumeDeletion"> = api,
  options: DeletionFlowOptions = {},
): Promise<DeleteWorldResponse> {
  const first = await client.resumeDeletion(worldId);
  const done = await pollDeletion(
    worldId,
    first,
    { ...client, deleteWorld: api.deleteWorld, setStatus: api.setStatus },
    options,
  );
  await purgeWorldFromCache(queryClient, worldId);
  return done;
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
      case "WORLD_BUSY":
        return "Il mondo è momentaneamente bloccato da un'altra operazione: nessun dato è stato eliminato, riprova tra qualche secondo.";
      case "DELETION_FAILED":
        return `L'eliminazione si è interrotta: il mondo resta nascosto e puoi riprovare per completarla.${error.requestId ? ` (codice richiesta ${error.requestId})` : ""}`;
      case "DELETION_PENDING":
        return error.message;
      default:
        return error.message;
    }
  }
  return "Eliminazione non riuscita. Riprova.";
}
