/**
 * Черновик «Арена-дистрикта» (PR 2): статичная сцена вместо слоёв арта.
 * PR 3 заменит её рисунком день / ночь / flat. Рекламных мест здесь нет — они появятся на арте (PR 4).
 * Цвета — CSS-переменные на `.dz[data-district="arena"]` (ночь и день). Свечение не анимируется.
 */
export function ArenaBowl() {
  return (
    <svg className="dz-bowl" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="arena-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-sky-0)" />
          <stop offset="100%" stopColor="var(--bowl-sky-1)" />
        </linearGradient>
        <linearGradient id="arena-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-ground-0)" />
          <stop offset="100%" stopColor="var(--bowl-ground-1)" />
        </linearGradient>
      </defs>
      <rect width="1600" height="1200" fill="url(#arena-sky)" />
      <g fill="var(--bowl-star)">
        <circle cx="180" cy="90" r="1.6" />
        <circle cx="420" cy="140" r="1.2" />
        <circle cx="760" cy="70" r="1.8" />
        <circle cx="1100" cy="120" r="1.3" />
        <circle cx="1380" cy="80" r="1.5" />
        <circle cx="960" cy="180" r="1.1" />
      </g>
      <path fill="var(--bowl-far)" d="M0 520 L180 470 L320 500 L480 430 L640 490 L820 410 L980 470 L1180 390 L1360 460 L1600 420 L1600 640 L0 640 Z" />
      <path
        fill="var(--bowl-mass)"
        d="M120 760 C280 430 1320 430 1480 760 L1420 860 C1280 620 320 620 180 860 Z"
      />
      <path fill="none" stroke="var(--bowl-rim)" strokeWidth="3" d="M260 700 C420 500 1180 500 1340 700" />
      <ellipse cx="800" cy="690" rx="250" ry="62" fill="none" stroke="var(--bowl-ring)" strokeWidth="3" />
      <ellipse cx="800" cy="690" rx="168" ry="40" fill="none" stroke="var(--bowl-ring)" strokeWidth="1.5" opacity="0.65" />
      <rect x="0" y="820" width="1600" height="380" fill="url(#arena-ground)" />
      <path fill="none" stroke="var(--bowl-line)" strokeWidth="2" d="M0 900 H1600" />
      <g fill="var(--bowl-win)">
        <rect x="210" y="640" width="18" height="10" />
        <rect x="250" y="600" width="18" height="10" />
        <rect x="1330" y="640" width="18" height="10" />
        <rect x="1370" y="600" width="18" height="10" />
      </g>
    </svg>
  );
}
