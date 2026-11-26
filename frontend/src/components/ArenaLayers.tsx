/**
 * Арт «Арена-дистрикта» кодом (PR 3): четыре слоя 4:3 в палитре лобби Арены.
 * День и ночь — переменные на `.dz[data-art]`. Рассвет и закат — подкраска `.dz-tint`, как у других районов.
 * Кольцо зоны статичное. Пустые панели — места под рекламу PR 4, без текста и без касаний.
 * Ворота на улице и ещё раз крупнее на ближнем плане.
 */
import type { ReactNode } from "react";

export type ArenaPart = "sky" | "far" | "mid" | "near" | "flat";

function Frame({ part, children }: { part: ArenaPart; children: ReactNode }) {
  return (
    <svg className="dz-bowl" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id={`arena-sky-${part}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-sky-0)" />
          <stop offset="55%" stopColor="var(--bowl-sky-1)" />
          <stop offset="100%" stopColor="var(--bowl-sky-2)" />
        </linearGradient>
        <radialGradient id={`arena-glow-${part}`} cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor="var(--bowl-glow)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--bowl-glow)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {children}
    </svg>
  );
}

function Sky({ part }: { part: ArenaPart }) {
  return (
    <g>
      <rect width="1600" height="1200" fill={`url(#arena-sky-${part})`} />
      <ellipse cx="800" cy="560" rx="520" ry="160" fill={`url(#arena-glow-${part})`} />
      <g className="bowl-star" fill="var(--bowl-star)">
        <circle cx="120" cy="80" r="1.6" />
        <circle cx="280" cy="160" r="1.1" />
        <circle cx="460" cy="60" r="1.4" />
        <circle cx="690" cy="130" r="1" />
        <circle cx="910" cy="50" r="1.7" />
        <circle cx="1120" cy="110" r="1.2" />
        <circle cx="1340" cy="70" r="1.5" />
        <circle cx="1480" cy="170" r="1" />
      </g>
    </g>
  );
}

function Far() {
  return (
    <g>
      <path fill="var(--bowl-far)" d="M0 560 L90 500 L160 540 L250 460 L340 520 L430 430 L520 510 L640 400 L760 490 L880 380 L1000 470 L1120 410 L1240 500 L1360 440 L1480 520 L1600 470 L1600 700 L0 700 Z" />
      <g fill="var(--bowl-win)">
        <rect x="270" y="490" width="6" height="6" />
        <rect x="450" y="460" width="6" height="6" />
        <rect x="660" y="430" width="6" height="6" />
        <rect x="900" y="410" width="6" height="6" />
        <rect x="1140" y="450" width="6" height="6" />
        <rect x="1380" y="480" width="6" height="6" />
      </g>
    </g>
  );
}

/** Пустые панели: экран на чаше, строка вдоль кольца, вывеска над воротами, баннер над площадью. */
function Slots() {
  return (
    <g fill="var(--bowl-slot)" stroke="var(--bowl-slot-edge)" strokeWidth="2">
      <rect x="680" y="548" width="240" height="120" />
      <rect x="600" y="700" width="400" height="26" />
      <rect x="560" y="300" width="120" height="100" />
      <path d="M560 300 h22 M658 300 h22 M680 300 v18 M680 382 v18 M560 400 v-18 M560 300 v18" fill="none" />
      <rect x="690" y="768" width="220" height="52" />
    </g>
  );
}

function Bowl() {
  return (
    <g>
      <path fill="var(--bowl-mass)" d="M160 820 C340 460 1260 460 1440 820 L1360 900 C1200 620 400 620 240 900 Z" />
      <path fill="none" stroke="var(--bowl-rim)" strokeWidth="3" d="M300 760 C460 540 1140 540 1300 760" />
      <ellipse cx="800" cy="700" rx="300" ry="78" fill="none" stroke="var(--bowl-ring)" strokeWidth="10" opacity="0.28" />
      <ellipse cx="800" cy="700" rx="300" ry="78" fill="none" stroke="var(--bowl-ring)" strokeWidth="2.5" />
      <ellipse cx="800" cy="700" rx="190" ry="46" fill="none" stroke="var(--bowl-ring)" strokeWidth="1.5" opacity="0.7" />
    </g>
  );
}

function Plaza() {
  let lines = "";
  for (let i = -8; i <= 8; i++) lines += `M${800 + i * 18} 760 L${800 + i * 140} 1200 `;
  return (
    <g>
      <rect y="860" width="1600" height="340" fill="var(--bowl-ground)" />
      <path d={lines} fill="none" stroke="var(--bowl-grid)" strokeWidth="1" />
      <line x1="0" y1="980" x2="1600" y2="980" stroke="var(--bowl-line)" strokeWidth="2" />
    </g>
  );
}

function Gates() {
  return (
    <g fill="var(--bowl-gate)" stroke="var(--bowl-ring)" strokeWidth="2">
      <rect x="650" y="860" width="26" height="200" />
      <rect x="924" y="860" width="26" height="200" />
      <rect x="650" y="860" width="300" height="16" />
    </g>
  );
}

/** Ближний план: стойки ворот по краям кадра, центр улицы остаётся свободным. */
function NearFrame() {
  return (
    <g fill="var(--bowl-gate)" stroke="var(--bowl-ring)" strokeWidth="2">
      <rect x="530" y="1048" width="30" height="70" />
      <rect x="1040" y="1048" width="30" height="70" />
      <rect x="530" y="1048" width="540" height="10" />
    </g>
  );
}

export function ArenaLayer({ part }: { part: ArenaPart }) {
  if (part === "flat") {
    return (
      <Frame part={part}>
        <Sky part={part} />
        <Far />
        <Bowl />
        <Slots />
        <Plaza />
        <Gates />
        <NearFrame />
      </Frame>
    );
  }
  return (
    <Frame part={part}>
      {part === "sky" && <Sky part={part} />}
      {part === "far" && <Far />}
      {part === "mid" && (
        <>
          <Bowl />
          <Slots />
          <Plaza />
          <Gates />
        </>
      )}
      {part === "near" && <NearFrame />}
    </Frame>
  );
}
