import { z } from "zod";
import { MAX_MAP_SIZE, MIN_MAP_SIZE } from "@genesis/simulation-core";
import { rosterInputSchema } from "./identity";

export const ALLOWED_TICKS = [1, 10, 50, 100] as const;
export type AllowedTicks = (typeof ALLOWED_TICKS)[number];

export const EVENT_TYPES = [
  "birth",
  "notable_death",
  "famine",
  "migration",
  "settlement_founded",
  "construction",
  "tech_discovered",
  "trade",
  "conflict",
  "battle",
  "peace",
  "settlement_collapse",
  "population_growth",
  "civilization_founded",
  "alliance",
  "tribe_extinct",
  "conquest",
  "climate",
  "epidemic",
  "leadership",
  "unrest",
  "culture",
  "settlement_growth",
  "civilization_transformed",
] as const;

const mapSize = z.coerce.number().int().min(MIN_MAP_SIZE).max(MAX_MAP_SIZE);

export const createWorldSchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(60, "Massimo 60 caratteri"),
  seed: z
    .string()
    .trim()
    .max(64, "Seed troppo lungo (max 64 caratteri)")
    .optional()
    .transform((v) => (v ? v : undefined)),
  width: mapSize.optional(),
  height: mapSize.optional(),
  /** Civilization roster. Omitted: random historical identities with a uniform start. */
  roster: rosterInputSchema.optional(),
});
export type CreateWorldInput = z.infer<typeof createWorldSchema>;

export const simulateSchema = z.object({
  ticks: z.number().refine((v): v is AllowedTicks => (ALLOWED_TICKS as readonly number[]).includes(v), {
    message: `I tick consentiti sono ${ALLOWED_TICKS.join(", ")}`,
  }),
});

/**
 * Deleting a world requires typing this exact phrase. The server compares it with the name it
 * reads from the database, never with anything the client says the name is.
 */
export function deleteConfirmationPhrase(worldName: string): string {
  return `ELIMINA ${worldName}`;
}

/** True when both the typed phrase and the typed name match the real name exactly. */
export function isDeleteConfirmed(
  realName: string,
  input: { confirmation: string; worldName: string },
): boolean {
  const norm = (v: string) => v.normalize("NFC");
  return (
    norm(input.worldName) === norm(realName) &&
    norm(input.confirmation) === norm(deleteConfirmationPhrase(realName))
  );
}

export const deleteWorldSchema = z
  .object({
    confirmation: z.string().min(1, "Conferma obbligatoria").max(200),
    worldName: z.string().min(1, "Nome del mondo obbligatorio").max(200),
  })
  .strict();
export type DeleteWorldInput = z.infer<typeof deleteWorldSchema>;

export const updateWorldSchema = z.object({
  status: z.enum(["running", "paused"]),
});

const yearSchema = z.coerce.number().int().min(-1_000_000).max(1_000_000);

export const eventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(EVENT_TYPES)).optional()),
  minImportance: z.coerce.number().int().min(1).max(5).optional(),
  /** Free-text search on title and description. */
  search: z.string().trim().max(120).optional(),
  /** Inclusive year range. */
  fromYear: yearSchema.optional(),
  toYear: yearSchema.optional(),
  /** Restricts to the events one entity (tribe, settlement, civilization, person) took part in. */
  actorId: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z]{1,3}\d+$/i, "Identificativo attore non valido")
    .optional(),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

export const statsQuerySchema = z.object({
  maxPoints: z.coerce.number().int().min(10).max(2000).default(400),
  civilizations: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export const personIdSchema = z
  .string()
  .trim()
  .regex(/^p\d+$/, "Identificativo persona non valido");

export const entityIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{1,3}\d+$/i, "Identificativo non valido");

export const worldIdSchema = z.string().uuid();
