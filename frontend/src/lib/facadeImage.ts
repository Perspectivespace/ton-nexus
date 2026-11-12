import { t } from "@/i18n";
/**
 * Картинка экрана на фасаде — проверка файла и подготовка перед загрузкой (сервер проверяет и пережимает ещё раз:
 * WebP 640×520 без метаданных). Перед отправкой большие фото уменьшаются в браузере (≤ 1600 px, JPEG):
 * загрузка быстрее и укладывается в ограничение тела запроса прокси. Не вышло (старый WebView) — уходит исходный файл.
 */
export const FACADE_MAX_BYTES = 5 * 1024 * 1024;
export const FACADE_ACCEPT = "image/png,image/jpeg,image/webp";
export const FACADE_OK_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** размер на экране после пережатия сервером (пропорция экрана на фасаде) */
export const FACADE_W = 640;
export const FACADE_H = 520;
export const FACADE_MIN_W = 320;
export const FACADE_MIN_H = 260;
const SHRINK_MAX = 1600;
const SHRINK_OVER_BYTES = 900 * 1024;

/** null — файл подходит для отправки на сервер */
export function facadeFileError(f: { type: string; size: number } | null): string | null {
  if (!f) return null;
  if (!FACADE_OK_TYPES.includes(f.type)) return t("ad.pic.badType");
  if (f.size <= 0) return t("ad.pic.empty");
  if (f.size > FACADE_MAX_BYTES) return t("ad.pic.tooBig");
  return null;
}

/** во сколько раз уменьшить, чтобы большая сторона была ≤ max (1 — не уменьшать) */
export function shrinkScale(w: number, h: number, max = SHRINK_MAX): number {
  const side = Math.max(w, h);
  return side > max ? max / side : 1;
}

/** Уменьшить большое фото перед загрузкой; маленькие файлы и ошибки — исходный файл. */
export async function shrinkForUpload(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file);
    const k = shrinkScale(bmp.width, bmp.height);
    if (k === 1 && file.size <= SHRINK_OVER_BYTES) return file;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d");
    if (!g) return file;
    g.fillStyle = "#0A0716"; // прозрачное — тёмный экран, как на сервере
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.9));
    return out && out.size > 0 && out.size < file.size ? out : file;
  } catch {
    return file;
  } finally {
    bmp?.close?.();
  }
}
