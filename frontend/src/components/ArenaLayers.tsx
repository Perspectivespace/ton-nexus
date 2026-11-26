/**
 * Финальный арт «Арена-дистрикта» (PR 3): четыре слоя SVG 4:3.
 * В покое на 360 px виден портрет входа (середина улицы, примерно x 523–1077) —
 * чаша, кольцо, ворота и четыре пустые панели должны читаться здесь.
 * Панорама открывает улицу, огибающую чашу, и дома по бокам.
 * День/ночь — переменные `.dz[data-art]`; рассвет и закат — `.dz-tint`.
 * Кольцо и свечение статичные. Геометрию панелей не менять (PR 4).
 */
import type { ReactNode } from "react";

export type ArenaPart = "sky" | "far" | "mid" | "near" | "flat";

/** Геометрия пустых рекламных панелей (viewBox 1600×1200). Не менять — на них опирается PR 4. */
export const ARENA_SLOTS = {
  facade: { id: "arena_facade", x: 680, y: 548, w: 240, h: 120 },
  line: { id: "arena_line", x: 600, y: 700, w: 400, h: 26 },
  banner: { id: "arena_banner", x: 560, y: 300, w: 120, h: 100 },
  neon: { id: "arena_neon", x: 690, y: 768, w: 220, h: 52 },
} as const;

const rnd = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 73 + 11) % 97;
    return s;
  };
};

const g = (part: ArenaPart, name: string) => `url(#arena-${name}-${part})`;

function Frame({ part, children }: { part: ArenaPart; children: ReactNode }) {
  const p = part;
  return (
    <svg className="dz-bowl" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id={`arena-sky-${p}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-sky-0)" />
          <stop offset="58%" stopColor="var(--bowl-sky-1)" />
          <stop offset="100%" stopColor="var(--bowl-sky-2)" />
        </linearGradient>
        <radialGradient id={`arena-glow-${p}`} cx="50%" cy="62%" r="55%">
          <stop offset="0%" stopColor="var(--bowl-glow)" stopOpacity="0.5" />
          <stop offset="45%" stopColor="var(--bowl-glow)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--bowl-glow)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`arena-ringglow-${p}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--bowl-ring)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--bowl-ring)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`arena-metal-${p}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-mass-hi)" />
          <stop offset="45%" stopColor="var(--bowl-mass)" />
          <stop offset="100%" stopColor="var(--bowl-concrete)" />
        </linearGradient>
        <linearGradient id={`arena-wall-${p}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--bowl-concrete)" />
          <stop offset="50%" stopColor="var(--bowl-mass-hi)" />
          <stop offset="100%" stopColor="var(--bowl-concrete)" />
        </linearGradient>
        <linearGradient id={`arena-ground-${p}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-street-hi)" />
          <stop offset="40%" stopColor="var(--bowl-street)" />
          <stop offset="100%" stopColor="var(--bowl-ground)" />
        </linearGradient>
        <linearGradient id={`arena-field-${p}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-field)" />
          <stop offset="100%" stopColor="var(--bowl-concrete)" />
        </linearGradient>
        <linearGradient id={`arena-gate-${p}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bowl-gate-hi)" />
          <stop offset="55%" stopColor="var(--bowl-gate)" />
          <stop offset="100%" stopColor="var(--bowl-concrete)" />
        </linearGradient>
        <linearGradient id={`arena-spec-${p}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="22%" stopColor="rgba(225, 240, 255, 0.28)" />
          <stop offset="62%" stopColor="rgba(225, 240, 255, 0.06)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <pattern id={`arena-cobble-${p}`} width="28" height="16" patternUnits="userSpaceOnUse">
          <rect width="28" height="16" fill="var(--bowl-street)" />
          <path d="M2 8 h10 M16 0 v8 M16 8 h10 M2 16 h10" fill="none" stroke="var(--bowl-cobble)" strokeWidth="1.2" />
        </pattern>
      </defs>
      {children}
    </svg>
  );
}

function Sky({ part }: { part: ArenaPart }) {
  const star = rnd(3);
  const stars = Array.from({ length: 40 }, (_, i) => {
    const q = star();
    return <circle key={i} cx={(q * 17 + i * 41) % 1600} cy={((q * 7 + i * 13) % 520) + 8} r={i % 5 ? 0.7 : 1.5} />;
  });
  return (
    <g>
      <rect width="1600" height="1200" fill={g(part, "sky")} />
      <ellipse cx="800" cy="640" rx="640" ry="220" fill={g(part, "glow")} />
      <g className="bowl-star" fill="var(--bowl-star)" fillOpacity="0.7">{stars}</g>
      <ellipse className="bowl-daycloud" cx="640" cy="160" rx="180" ry="20" fill="var(--bowl-cloud)" />
      <ellipse className="bowl-daycloud" cx="980" cy="120" rx="140" ry="16" fill="var(--bowl-cloud)" />
    </g>
  );
}

function farTower(x: number, yBase: number, w: number, h: number, seed: number, key: string) {
  const r = rnd(seed);
  const wins: ReactNode[] = [];
  const cols = Math.max(2, Math.floor(w / 11));
  const rows = Math.max(2, Math.floor(h / 14));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = r();
      if (v % 3 === 0) {
        wins.push(
          <rect
            key={`${key}-${row}-${col}`}
            x={x + 3 + col * (w / cols)}
            y={yBase - h + 5 + row * (h / rows)}
            width="3.5"
            height="5"
            fill={v % 5 === 0 ? "var(--bowl-win-warm)" : "var(--bowl-win)"}
            opacity={0.65 + (v % 4) * 0.08}
          />,
        );
      }
    }
  }
  return (
    <g key={key}>
      <rect x={x} y={yBase - h} width={w} height={h} fill="var(--bowl-far)" />
      <rect x={x} y={yBase - h} width={Math.max(2, w * 0.12)} height={h} fill="var(--bowl-far-2)" />
      {wins}
    </g>
  );
}

function Far() {
  const r = rnd(17);
  const back: ReactNode[] = [];
  const front: ReactNode[] = [];
  let x = 0;
  let i = 0;
  while (x < 1600) {
    const s = r();
    const w = 16 + (s % 20);
    // в центре ниже, чтобы над чашей оставалась тонкая линия города, не «горы»
    const dip = Math.abs(x + w / 2 - 800) < 280 ? 0.45 : 1;
    const h = (40 + (s % 80)) * dip + 18;
    back.push(farTower(x, 628, w - 1, h, s + i, `b${i}`));
    x += w;
    i += 1;
  }
  x = -8;
  i = 0;
  while (x < 1600) {
    const s = r();
    const w = 20 + (s % 24);
    const dip = Math.abs(x + w / 2 - 800) < 300 ? 0.4 : 1;
    const h = (48 + (s % 64)) * dip + 16;
    front.push(farTower(x, 668, w - 1, h, s + 50 + i, `c${i}`));
    x += w;
    i += 1;
  }
  return (
    <g>
      <rect x="0" y="628" width="1600" height="80" fill="var(--bowl-far-2)" opacity="0.9" />
      {back}
      {front}
    </g>
  );
}

function Building({
  x, y, w, h, seed, warm,
}: { x: number; y: number; w: number; h: number; seed: number; warm?: boolean }) {
  const r = rnd(seed);
  const wins: ReactNode[] = [];
  const cols = Math.max(2, Math.floor((w - 12) / 15));
  const rows = Math.max(2, Math.floor((h - 20) / 20));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = r();
      const lit = v % 3 !== 0;
      wins.push(
        <rect
          key={`${row}-${col}`}
          x={x + 7 + col * ((w - 12) / cols)}
          y={y + 14 + row * ((h - 18) / rows)}
          width="7"
          height="9"
          fill={lit ? (warm || v % 5 === 1 ? "var(--bowl-win-warm)" : "var(--bowl-win)") : "var(--bowl-win-off)"}
          opacity={lit ? 0.82 : 0.4}
        />,
      );
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="var(--bowl-build)" />
      <rect x={x} y={y} width={w} height="4" fill="var(--bowl-mass-hi)" />
      <rect x={x + w - 7} y={y} width="7" height={h} fill="var(--bowl-build-side)" />
      <rect x={x} y={y} width="4" height={h} fill="var(--bowl-build-side)" opacity="0.7" />
      {wins}
    </g>
  );
}

function Scene({ part }: { part: ArenaPart }) {
  const tiers: ReactNode[] = [];
  for (let i = 0; i < 9; i++) {
    tiers.push(
      <ellipse
        key={i}
        cx="800"
        cy={698 + i * 5}
        rx={292 - i * 22}
        ry={76 - i * 6}
        fill="none"
        stroke="var(--bowl-seat)"
        strokeWidth="7"
        strokeDasharray="10 5"
        opacity="0.9"
      />,
    );
  }
  const lights: ReactNode[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (Math.PI * i) / 27;
    lights.push(
      <circle
        key={i}
        cx={800 + Math.cos(Math.PI + a) * 300}
        cy={700 + Math.sin(Math.PI + a) * 78}
        r="3.4"
        fill="var(--bowl-lamp)"
        opacity="0.92"
      />,
    );
  }
  const { facade, line, neon, banner } = ARENA_SLOTS;
  type Slot = (typeof ARENA_SLOTS)[keyof typeof ARENA_SLOTS];
  const glass = (s: Slot) => (
    <g data-spot={s.id} key={s.id}>
      <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="var(--bowl-slot)" stroke="var(--bowl-slot-edge)" strokeWidth="2" />
      <rect x={s.x + 4} y={s.y + 3} width={s.w - 8} height={s.h - 6} fill="none" stroke="var(--bowl-slot-edge)" strokeWidth="1" opacity="0.35" />
      <rect x={s.x + 6} y={s.y + 4} width={Math.min(48, s.w / 3)} height="2" fill="var(--bowl-slot-edge)" opacity="0.3" />
    </g>
  );
  let grid = "";
  for (let i = -8; i <= 8; i++) grid += `M${800 + i * 18} 760 L${800 + i * 140} 1200 `;
  return (
    <g>
      {/* чаша: внешняя масса + внутренняя выемка */}
      <path fill={g(part, "metal")} d="M160 820 C340 460 1260 460 1440 820 L1360 900 C1200 620 400 620 240 900 Z" />
      <path fill={g(part, "wall")} fillOpacity="0.55" d="M260 800 C420 520 1180 520 1340 800 L1280 860 C1140 620 460 620 320 860 Z" />
      <path fill="none" stroke="var(--bowl-rim)" strokeWidth="4" d="M300 760 C460 540 1140 540 1300 760" />
      <path fill="none" stroke="var(--bowl-mass-hi)" strokeWidth="2" opacity="0.7" d="M340 790 C500 560 1100 560 1260 790" />
      {/* панели фасада вокруг экрана, не заезжая на слоты */}
      <g fill="none" stroke="var(--bowl-mass-hi)" strokeWidth="1.4" opacity="0.5">
        <path d="M430 640 L430 760" />
        <path d="M520 600 L520 760" />
        <path d="M1080 600 L1080 760" />
        <path d="M1170 640 L1170 760" />
      </g>
      <g fill="var(--bowl-win)" opacity="0.7">
        <rect x="450" y="650" width="6" height="8" />
        <rect x="470" y="650" width="6" height="8" />
        <rect x="450" y="668" width="6" height="8" />
        <rect x="470" y="668" width="6" height="8" />
        <rect x="1124" y="650" width="6" height="8" />
        <rect x="1144" y="650" width="6" height="8" />
        <rect x="1124" y="668" width="6" height="8" />
        <rect x="1144" y="668" width="6" height="8" />
      </g>
      <ellipse cx="800" cy="708" rx="300" ry="80" fill={g(part, "field")} />
      {tiers}
      <ellipse cx="800" cy="746" rx="96" ry="24" fill="var(--bowl-field)" stroke="var(--bowl-ring)" strokeWidth="1.2" />
      {/* статичное голо-кольцо */}
      <ellipse cx="800" cy="700" rx="330" ry="92" fill={g(part, "ringglow")} />
      <ellipse cx="800" cy="700" rx="300" ry="78" fill="none" stroke="var(--bowl-ring)" strokeWidth="10" opacity="0.28" />
      <ellipse cx="800" cy="700" rx="300" ry="78" fill="none" stroke="var(--bowl-ring)" strokeWidth="2.6" />
      <ellipse cx="800" cy="700" rx="190" ry="46" fill="none" stroke="var(--bowl-ring)" strokeWidth="1.5" opacity="0.75" />
      {lights}
      <rect x="360" y="500" width="880" height="6" fill={g(part, "spec")} opacity="0.85" />

      {/* дома у краёв кадра в покое (≈523 и ≈1077) и дальше — улица огибает чашу при панорамировании */}
      <Building x={200} y={560} w={150} h={360} seed={21} />
      <Building x={330} y={620} w={130} h={300} seed={27} warm />
      <Building x={500} y={640} w={110} h={280} seed={31} />
      <Building x={990} y={640} w={110} h={280} seed={35} warm />
      <Building x={1140} y={620} w={130} h={300} seed={39} />
      <Building x={1250} y={560} w={150} h={360} seed={43} warm />

      {/* пустые панели — те же координаты */}
      <g fill="var(--bowl-slot)" stroke="var(--bowl-slot-edge)" strokeWidth="2">
        {glass(facade)}
        {glass(line)}
        {glass(banner)}
        <path d="M560 300 h22 M658 300 h22 M680 300 v18 M680 382 v18 M560 400 v-18 M560 300 v18" fill="none" />
        {glass(neon)}
      </g>

      {/* площадь и улица, огибающая чашу */}
      <path fill={g(part, "ground")} d="M0 820 C200 780 400 900 800 860 C1200 900 1400 780 1600 820 L1600 1200 L0 1200 Z" />
      <path fill={g(part, "cobble")} d="M0 860 C260 820 500 920 800 880 C1100 920 1340 820 1600 860 L1600 1200 L0 1200 Z" opacity="0.9" />
      <path d={grid} fill="none" stroke="var(--bowl-grid)" strokeWidth="1" />
      <path d="M180 860 C400 780 1200 780 1420 860" fill="none" stroke="var(--bowl-rim)" strokeWidth="3.5" opacity="0.55" />
      <line x1="0" y1="980" x2="1600" y2="980" stroke="var(--bowl-line)" strokeWidth="2" opacity="0.45" />
      <ellipse cx="740" cy="1000" rx="10" ry="36" fill="var(--bowl-reflect-c)" />
      <ellipse cx="860" cy="1020" rx="9" ry="40" fill="var(--bowl-reflect-m)" />
      <ellipse cx="800" cy="1110" rx="14" ry="50" fill="var(--bowl-reflect-c)" />

      {/* фонари у входа, в кадре покоя */}
      <g>
        {[560, 1040].map((x) => (
          <g key={x}>
            <rect x={x} y="820" width="7" height="150" fill={g(part, "gate")} />
            <circle cx={x + 3.5} cy="816" r="9" fill="var(--bowl-lamp)" />
            <ellipse cx={x + 3.5} cy="970" rx="30" ry="11" fill="var(--bowl-lamp)" opacity="0.14" />
          </g>
        ))}
      </g>

      {/* ворота: металл с фаской, не одна обводка */}
      <g>
        <rect x={642} y={860} width={8} height={200} fill="var(--bowl-build-side)" />
        <rect x={650} y={860} width={26} height={200} fill={g(part, "gate")} stroke="var(--bowl-ring)" strokeWidth="2" />
        <rect x={654} y={868} width={18} height={10} fill={g(part, "spec")} />
        <rect x={916} y={860} width={8} height={200} fill="var(--bowl-build-side)" />
        <rect x={924} y={860} width={26} height={200} fill={g(part, "gate")} stroke="var(--bowl-ring)" strokeWidth="2" />
        <rect x={928} y={868} width={18} height={10} fill={g(part, "spec")} />
        <rect x={650} y={860} width={300} height={18} fill={g(part, "gate")} stroke="var(--bowl-ring)" strokeWidth="2" />
        <rect x={656} y={863} width={288} height={4} fill="var(--bowl-ring)" opacity="0.55" />
      </g>
    </g>
  );
}

function NearFrame({ part }: { part: ArenaPart }) {
  return (
    <g>
      <rect x={0} y={1120} width={1600} height={80} fill="var(--bowl-ground)" opacity="0.65" />
      <rect x={522} y={1048} width={8} height={70} fill="var(--bowl-build-side)" />
      <rect x={530} y={1048} width={30} height={70} fill={g(part, "gate")} stroke="var(--bowl-ring)" strokeWidth="2" />
      <rect x={1032} y={1048} width={8} height={70} fill="var(--bowl-build-side)" />
      <rect x={1040} y={1048} width={30} height={70} fill={g(part, "gate")} stroke="var(--bowl-ring)" strokeWidth="2" />
      <rect x={530} y={1048} width={540} height={12} fill={g(part, "gate")} stroke="var(--bowl-ring)" strokeWidth="2" />
      <rect x={536} y={1050} width={528} height={4} fill="var(--bowl-ring)" opacity="0.55" />
      <circle cx="545" cy="1084" r="3.2" fill="var(--bowl-lamp)" />
      <circle cx="1055" cy="1084" r="3.2" fill="var(--bowl-lamp)" />
    </g>
  );
}

export function ArenaLayer({ part }: { part: ArenaPart }) {
  if (part === "flat") {
    return (
      <Frame part={part}>
        <Sky part={part} />
        <Far />
        <Scene part={part} />
        <NearFrame part={part} />
      </Frame>
    );
  }
  return (
    <Frame part={part}>
      {part === "sky" && <Sky part={part} />}
      {part === "far" && <Far />}
      {part === "mid" && <Scene part={part} />}
      {part === "near" && <NearFrame part={part} />}
    </Frame>
  );
}
