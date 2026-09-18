import { z } from "zod";
import { MAX_MAP_SIZE, MIN_MAP_SIZE } from "@genesis/simulation-core";

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
});
export type CreateWorldInput = z.infer<typeof createWorldSchema>;

export const simulateSchema = z.object({
  ticks: z.number().refine((v): v is AllowedTicks => (ALLOWED_TICKS as readonly number[]).includes(v), {
    message: `I tick consentiti sono ${ALLOWED_TICKS.join(", ")}`,
  }),
});

export const updateWorldSchema = z.object({
  status: z.enum(["running", "paused"]),
});

export const eventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(EVENT_TYPES)).optional()),
  minImportance: z.coerce.number().int().min(1).max(5).optional(),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

export const statsQuerySchema = z.object({
  maxPoints: z.coerce.number().int().min(10).max(2000).default(400),
});

export const worldIdSchema = z.string().uuid();
