type Level = "debug" | "info" | "warn" | "error";

/** Structured JSON logs: one line per event, easy to query in Vercel's log viewer. */
function write(level: Level, event: string, data: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  if (process.env.VITEST && level !== "error") return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => write("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => write("error", event, data),
};

export function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error)
    return {
      message: error.message,
      name: error.name,
      stack: error.stack?.split("\n").slice(0, 5).join("\n"),
    };
  return { message: String(error) };
}
