/**
 * Облик реактора по уровню (docs/DESIGN.md, п. 8.1.1).
 * Уровень реактора = сумма пяти характеристик − 4 (на старте все по 1 → уровень 1).
 * Новый облик — новая строка в TIERS и класс `.rx.tN` в styles/rx-tiers.css (например, «Легенда» с 30 ур.).
 */
export type ReactorTier = {
  id: number;
  /** с какого уровня реактора */
  from: number;
  mk: string;
  name: string;
  /** что меняется, коротко — для тоста и тизера */
  look: string;
};

export const REACTOR_TIERS: readonly ReactorTier[] = [
  { id: 0, from: 1, mk: "Mk I", name: "Прототип", look: "циановое ядро, базовый корпус" },
  { id: 1, from: 5, mk: "Mk II", name: "Контур", look: "стальная броня, световые швы, HUD-кольцо" },
  { id: 2, from: 10, mk: "Mk III", name: "Марк", look: "золото-титан, катушки, ядро добела" },
  { id: 3, from: 20, mk: "Mk IV", name: "Сингулярность", look: "призменное ядро, орбиты, маджента" },
];

type Stats = { power: number; capacity: number; acceleration: number; luck: number; stability: number };

export function reactorLevel(m: Stats): number {
  const sum = [m.power, m.capacity, m.acceleration, m.luck, m.stability].reduce((a, b) => a + (Number(b) || 0), 0);
  return Math.max(1, sum - 4);
}

export function tierFor(level: number): ReactorTier {
  let t = REACTOR_TIERS[0];
  for (const x of REACTOR_TIERS) if (level >= x.from) t = x;
  return t;
}

export function nextTier(t: ReactorTier): ReactorTier | undefined {
  return REACTOR_TIERS.find((x) => x.id === t.id + 1);
}

/** какой облик уже показан на этом устройстве (раскрытие — один раз за облик) */
const SEEN_KEY = "rx:seen-tier";
export function seenTier(): number {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
export function markTierSeen(id: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    /* приватный режим — раскрытие просто повторится */
  }
}
