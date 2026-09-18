import type {
  ApiErrorBody,
  EventsPage,
  SimulateResponse,
  StatsPoint,
  WorldDetail,
  WorldListItem,
} from "@/lib/dto";

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
  createWorld: (input: { name: string; seed?: string; width?: number; height?: number }) =>
    request<{ worldId: string; world: WorldListItem }>("/api/worlds", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getWorld: (id: string) => request<WorldDetail>(`/api/worlds/${id}`),
  setStatus: (id: string, status: "running" | "paused") =>
    request<WorldListItem>(`/api/worlds/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteWorld: (id: string) => request<{ deleted: boolean }>(`/api/worlds/${id}`, { method: "DELETE" }),
  simulate: (id: string, ticks: number) =>
    request<SimulateResponse>(`/api/worlds/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify({ ticks }),
    }),
  events: (id: string, params: { page: number; pageSize: number; type?: string; minImportance?: number }) => {
    const q = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.type) q.set("type", params.type);
    if (params.minImportance) q.set("minImportance", String(params.minImportance));
    return request<EventsPage>(`/api/worlds/${id}/events?${q}`);
  },
  stats: (id: string) => request<StatsPoint[]>(`/api/worlds/${id}/stats?maxPoints=400`),
};

export const queryKeys = {
  worlds: ["worlds"] as const,
  world: (id: string) => ["world", id] as const,
  events: (id: string) => ["events", id] as const,
  stats: (id: string) => ["stats", id] as const,
};
