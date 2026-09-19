import type { CivilizationRosterConfigInput } from "@genesis/simulation-core";
import type {
  ApiErrorBody,
  CivilizationHistoryDTO,
  EventsPage,
  IdentityDetailDTO,
  IdentityPageDTO,
  WorldCivilizationDetailDTO,
  PersonDTO,
  SimulateResponse,
  StatsResponse,
  WorldDetail,
  WorldListItem,
} from "@/lib/dto";

export interface DeleteWorldResponse {
  worldId: string;
  name: string;
  deleted: Record<string, number>;
  total: number;
}

export interface EventFilters {
  page: number;
  pageSize: number;
  type?: string;
  minImportance?: number;
  search?: string;
  fromYear?: number;
  toYear?: number;
  actorId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("NETWORK", "Server non raggiungibile. Controlla la connessione e riprova.", 0);
  }
  const body = (await res.json().catch(() => null)) as ({ data: T } & Partial<ApiErrorBody>) | null;
  if (!res.ok || !body || body.error) {
    throw new ApiError(
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? `Richiesta fallita (${res.status})`,
      res.status,
    );
  }
  return body.data;
}

export const api = {
  listWorlds: () => request<WorldListItem[]>("/api/worlds"),
  createWorld: (input: {
    name: string;
    seed?: string;
    width?: number;
    height?: number;
    roster?: CivilizationRosterConfigInput;
  }) =>
    request<{ worldId: string; world: WorldListItem }>("/api/worlds", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getWorld: (id: string) => request<WorldDetail>(`/api/worlds/${id}`),
  setStatus: (id: string, status: "running" | "paused") =>
    request<WorldListItem>(`/api/worlds/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  /** Deletes a world and all its data; the server checks the phrase against the stored name. */
  deleteWorld: (id: string, input: { confirmation: string; worldName: string }) =>
    request<DeleteWorldResponse>(`/api/worlds/${id}`, { method: "DELETE", body: JSON.stringify(input) }),
  simulate: (id: string, ticks: number) =>
    request<SimulateResponse>(`/api/worlds/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify({ ticks }),
    }),
  events: (id: string, params: EventFilters) => {
    const q = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.type) q.set("type", params.type);
    if (params.minImportance) q.set("minImportance", String(params.minImportance));
    if (params.search) q.set("search", params.search);
    if (params.fromYear !== undefined) q.set("fromYear", String(params.fromYear));
    if (params.toYear !== undefined) q.set("toYear", String(params.toYear));
    if (params.actorId) q.set("actorId", params.actorId);
    return request<EventsPage>(`/api/worlds/${id}/events?${q}`);
  },
  stats: (id: string, options: { civilizations?: boolean } = {}) =>
    request<StatsResponse>(
      `/api/worlds/${id}/stats?maxPoints=400${options.civilizations ? "&civilizations=true" : ""}`,
    ),
  person: (id: string, personId: string) => request<PersonDTO>(`/api/worlds/${id}/people/${personId}`),
  /** Catalog summaries; fetched only when the player opens the identity picker. */
  identities: () => request<IdentityPageDTO>("/api/historical-identities?pageSize=50"),
  identity: (key: string) => request<IdentityDetailDTO>(`/api/historical-identities/${key}`),
  civilization: (id: string, civId: string) =>
    request<WorldCivilizationDetailDTO>(`/api/worlds/${id}/civilizations/${civId}`),
  civilizationHistory: (id: string, civId: string, page = 1) =>
    request<CivilizationHistoryDTO>(
      `/api/worlds/${id}/civilizations/${civId}/history?page=${page}&pageSize=20`,
    ),
};

export const queryKeys = {
  worlds: ["worlds"] as const,
  world: (id: string) => ["world", id] as const,
  events: (id: string) => ["events", id] as const,
  stats: (id: string) => ["stats", id] as const,
  person: (id: string, personId: string) => ["person", id, personId] as const,
  identities: ["identities"] as const,
  identity: (key: string) => ["identity", key] as const,
  civilization: (id: string, civId: string) => ["civilization", id, civId] as const,
};
