import { layerFiles, type Art, type LayerId, type SceneDistrict } from "@/lib/districts";

/**
 * Загрузка слоёв района по требованию: каждый файл — отдельный адрес (import.meta.glob, ?url), качается только
 * когда открыт его район (или в простое — как соседний). Картинка декодируется до показа — без вспышки.
 */
const FILES = import.meta.glob<string>("../assets/districts/*.webp", { query: "?url", import: "default" });

export type LayerUrls = Partial<Record<LayerId | "flat", string>>;

function decode(src: string): Promise<void> {
  return new Promise((res) => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    const done = () => res();
    if (typeof img.decode === "function") img.decode().then(done, done);
    else {
      img.onload = done;
      img.onerror = done;
    }
  });
}

const cache = new Map<string, Promise<LayerUrls>>();

export function loadDistrict(d: SceneDistrict, art: Art, lite: boolean): Promise<LayerUrls> {
  const key = `${d}:${art}:${lite ? 1 : 0}`;
  let p = cache.get(key);
  if (!p) {
    const list = layerFiles(d, art, lite);
    p = Promise.all(
      list.map(async ({ id, file }) => {
        const load = FILES[`../assets/districts/${file}.webp`];
        if (!load) throw new Error(`нет слоя ${file}`);
        const url = await load();
        await decode(url);
        return [id, url] as const;
      }),
    ).then(
      (pairs) => Object.fromEntries(pairs) as LayerUrls,
      (e) => {
        cache.delete(key); // сеть моргнула — следующая попытка загрузит заново
        throw e;
      },
    );
    cache.set(key, p);
  }
  return p;
}

/** подкачать в простое (соседний район): не мешает текущему экрану */
export function preloadWhenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(t);
}
