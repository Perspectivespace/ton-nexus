import { Skeleton, SkeletonCard } from "@/components/ui/States";

/**
 * Заглушка раздела, пока грузится его чанк (обычно не видна: разделы подтягиваются заранее).
 * Форма — как у экрана: шапка и две карточки на стекле «Ночного контура». Проявляется с задержкой 150 мс,
 * чтобы быстрая загрузка не мигала; «уменьшить движение» — сразу, без перехода.
 */
export function RouteSkeleton() {
  return (
    <div className="route-sk space-y-5" aria-busy="true" aria-label="Загрузка раздела">
      <div className="grid min-h-[40px] gap-2 pt-1">
        <Skeleton w="28%" h={8} />
        <Skeleton w="52%" h={22} />
      </div>
      <SkeletonCard lines={3} label="Загрузка" />
      <SkeletonCard lines={2} label="Синхронизация" />
    </div>
  );
}
