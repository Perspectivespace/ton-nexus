import { getInitData } from "@/lib/telegram";

const BASE = import.meta.env.VITE_API_BASE || "";

/** Полный адрес ресурса API (картинка в <img>): путь с сервера + VITE_API_BASE, если API на другом адресе. */
export const apiUrl = (path: string) => `${BASE}${path}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const initData = getInitData();
  if (initData) headers.set("X-Telegram-Init-Data", initData);

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      // detail бывает строкой или объектом ({code, message, ...}) — объект отдаём как JSON, его разбирает вызывающий
      const d = body.detail ?? body;
      detail = typeof d === "string" ? d || res.statusText : JSON.stringify(d);
    } catch {
      /* */
    }
    throw new ApiError(res.status, String(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function rawError(res: Response): Promise<ApiError> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    const d = body.detail ?? body;
    detail = typeof d === "string" ? d || res.statusText : JSON.stringify(d);
  } catch {
    /* */
  }
  return new ApiError(res.status, String(detail));
}

/** Загрузка файла «как есть» (тело запроса — сами байты, Content-Type — тип файла). */
export async function apiUpload<T>(path: string, file: Blob): Promise<T> {
  const headers = new Headers();
  headers.set("Content-Type", file.type || "application/octet-stream");
  const initData = getInitData();
  if (initData) headers.set("X-Telegram-Init-Data", initData);
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: file, headers });
  if (!res.ok) throw await rawError(res);
  return res.json() as Promise<T>;
}

/** Закрытая картинка (только с заголовком авторизации) → Blob; в <img> её отдают через URL.createObjectURL. */
export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const initData = getInitData();
  if (initData) headers.set("X-Telegram-Init-Data", initData);
  const res = await fetch(`${BASE}${path}`, { headers, cache: "no-store" });
  if (!res.ok) throw await rawError(res);
  return res.blob();
}
