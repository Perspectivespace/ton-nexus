/**
 * Проверка seed карты (commit–reveal, RULES.md): до боя сервер показывает seed_hash,
 * после конца раскрывает seed и соль. Карта честная, если sha256("<соль>:<seed>") == seed_hash.
 * Считает браузер (Web Crypto) — серверу верить не нужно.
 */
export type SeedCheck = "ok" | "bad" | "na";

export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkSeed(seed: number | string, salt: string, hash: string): Promise<SeedCheck> {
  const got = await sha256Hex(`${salt}:${seed}`);
  if (got == null) return "na";
  return got === hash.trim().toLowerCase() ? "ok" : "bad";
}
