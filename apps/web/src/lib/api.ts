import { tg } from "./telegram";

// Empty in production: the API is served from the same domain under /api.
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Outside Telegram (local dev) the API accepts ?dev=<telegram id>, remembered in localStorage. */
function devUser(): string | null {
  const fromUrl = new URLSearchParams(location.search).get("dev");
  try {
    if (fromUrl) localStorage.setItem("devUser", fromUrl);
    return fromUrl ?? localStorage.getItem("devUser");
  } catch {
    return fromUrl;
  }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tg?.initData) headers.Authorization = `tma ${tg.initData}`;
  else {
    const dev = devUser();
    if (dev) headers["X-Dev-User"] = dev;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Xatolik yuz berdi");
  return data as T;
}
