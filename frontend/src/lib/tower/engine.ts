/**
 * «Башня» — игровая логика. Чистый модуль: ни DOM, ни Date, ни Math.random.
 *
 * Результат забега целиком определяется парой (seed, taps): seed — число, которое выдаёт сервер, taps — журнал тапов
 * (целые миллисекунды от начала забега по игровым часам, где пауза не идёт). Один и тот же вход всегда даёт один
 * и тот же счёт — поэтому следующий PR сможет перепроверять забег на сервере (replay), а клиенту достаточно
 * прислать seed и taps. Вся арифметика — целые числа (плюс Math.floor от целого/1000), без sin/cos и float-накопления:
 * порт на Python даёт ровно те же числа (mulberry32 — маски 32 бита, v * t // 1000).
 *
 * Мир: поле шириной FIELD единиц, блок высотой BLOCK_H. Башня — стопка блоков {x, w} (левый край и ширина).
 * Скользящий блок ходит «туда-обратно» (треугольная волна) по участку SPAN единиц; его положение — функция времени
 * с момента появления: pos(t) = tri(floor(v * t / 1000) + phase), поэтому тап оценивается точно в свою миллисекунду,
 * а не по кадру отрисовки.
 *
 * Правила (все числа — в CONFIG ниже, их же проверяют тесты):
 *  — тап роняет блок; часть, что свесилась за край башни, отрезается, остаток становится новым верхом;
 *  — «идеально»: край отличается от верха не больше PERFECT_TOL единиц — блок встаёт ровно, ничего не режется;
 *  — серия идеальных подряд (combo): очки растут, а с 3-го идеального блок чуть расширяется (до начальной ширины);
 *  — промах мимо башни (нет перекрытия) — конец забега;
 *  — скорость растёт с каждым блоком до потолка.
 */

export const CONFIG = {
  /** ширина поля, ед. */
  FIELD: 1000,
  /** высота блока, ед. */
  BLOCK_H: 60,
  /** ширина первого (опорного) блока и потолок ширины при расширении */
  W0: 360,
  /** половина хода центра скользящего блока от середины поля */
  RANGE: 440,
  /** допуск «идеально» по левому краю, ед. (≈ 1,4 % ширины поля) */
  PERFECT_TOL: 14,
  /** расширение блока за идеальный сверх 2-го подряд, ед. */
  REGROW: 10,
  /** с какого идеального подряд блок начинает расширяться */
  REGROW_FROM: 3,
  /** скорость скольжения, ед./с: V0 + DV за каждый поставленный блок, не больше VMAX */
  V0: 480,
  DV: 11,
  VMAX: 1400,
  /** очки: обычный блок */
  PTS_DROP: 1,
  /** очки: идеальный = PTS_PERFECT + min(combo - 1, COMBO_CAP), combo считается с 1 */
  PTS_PERFECT: 2,
  COMBO_CAP: 4,
  /** бустер «Замедление»: первые SLOW_BLOCKS блоков едут со скоростью SLOW_PCT % от обычной (целое, округление вниз) */
  SLOW_BLOCKS: 10,
  SLOW_PCT: 85,
  /** бустер «Прицел»: тонкая линия на идеальной точке первые AIM_BLOCKS блоков. Только картинка — на счёт не влияет */
  AIM_BLOCKS: 5,
} as const;

/**
 * Пределы, которые сервер проверяет у журнала тапов (не часть игровой логики: на счёт не влияют, а отсекают то, чего человек
 * не делает). Клиент сам их не нарушает: тап раньше предела просто не принимается. Те же числа — в backend/app/services/tower.py.
 */
export const LIMITS = {
  /** первый тап не раньше, чем через столько мс от начала забега */
  MIN_FIRST_TAP_MS: 100,
  /** между соседними тапами не меньше стольких мс */
  MIN_TAP_GAP_MS: 70,
} as const;

/**
 * Бустер забега (не больше одного за игру). «slow» меняет скорость — поэтому входит в replay, и сервер проверяет
 * забег с тем же флагом. «aim» рисуется только на экране: replay с ним и без него даёт одно и то же.
 */
export type Booster = "slow" | "aim";

/** длина хода левого края скользящего блока (константа: ход считается по центру блока) */
export const SPAN = CONFIG.RANGE * 2;

export interface Block {
  /** левый край, ед. */
  x: number;
  /** ширина, ед. */
  w: number;
}

export type DropKind = "perfect" | "cut" | "miss";

export interface DropResult {
  kind: DropKind;
  /** положение упавшего блока до обрезки (то, что видел игрок) */
  drop: Block;
  /** новый верх башни (для miss — не меняется) */
  placed: Block | null;
  /** отрезанный кусок (для miss — весь блок, для perfect — null) */
  cut: Block | null;
  points: number;
  combo: number;
  /** высота верха башни до броска (индекс слоя, куда встал блок) */
  level: number;
  /** игровое время тапа, мс */
  t: number;
}

export interface Game {
  readonly seed: number;
  /** бустер забега или null */
  readonly booster: Booster | null;
  /** состояние mulberry32 (uint32) */
  rng: number;
  /** башня снизу вверх; blocks[0] — опора */
  blocks: Block[];
  score: number;
  /** идеальных подряд сейчас */
  combo: number;
  bestCombo: number;
  perfects: number;
  over: boolean;
  /** когда появился текущий скользящий блок, мс */
  spawnT: number;
  /** ширина и фаза текущего скользящего блока */
  w: number;
  phase: number;
  /** принятые тапы (мс от начала) — журнал для replay */
  taps: number[];
}

/** mulberry32: следующее uint32 и новое состояние */
function next(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [(t ^ (t >>> 14)) >>> 0, s >>> 0];
}

function spawn(g: Game, t: number) {
  const [r, s] = next(g.rng);
  g.rng = s;
  g.spawnT = t;
  g.w = g.blocks[g.blocks.length - 1].w;
  g.phase = r % (SPAN * 2);
}

export function newGame(seed: number, booster: Booster | null = null): Game {
  const g: Game = {
    seed: seed >>> 0,
    booster,
    rng: seed >>> 0,
    blocks: [{ x: (CONFIG.FIELD - CONFIG.W0) / 2, w: CONFIG.W0 }],
    score: 0,
    combo: 0,
    bestCombo: 0,
    perfects: 0,
    over: false,
    spawnT: 0,
    w: CONFIG.W0,
    phase: 0,
    taps: [],
  };
  spawn(g, 0);
  return g;
}

/** скорость скольжения текущего блока, ед./с (зависит от числа уже поставленных блоков и от бустера «slow») */
export function speedFor(placed: number, booster: Booster | null = null): number {
  const v = Math.min(CONFIG.VMAX, CONFIG.V0 + CONFIG.DV * placed);
  return booster === "slow" && placed < CONFIG.SLOW_BLOCKS ? Math.floor((v * CONFIG.SLOW_PCT) / 100) : v;
}

/** позиция по треугольной волне: целое от 0 до SPAN */
function tri(d: number): number {
  const m = d % (SPAN * 2);
  return m <= SPAN ? m : SPAN * 2 - m;
}

/** левый край скользящего блока в игровое время t (мс); до появления блока стоит на месте */
export function sliderX(g: Game, t: number): number {
  const dt = Math.max(0, t - g.spawnT);
  const d = Math.floor((speedFor(g.blocks.length - 1, g.booster) * dt) / 1000) + g.phase;
  return CONFIG.FIELD / 2 - CONFIG.RANGE - (g.w >> 1) + tri(d);
}

/** верх башни */
export const top = (g: Game): Block => g.blocks[g.blocks.length - 1];

/**
 * Тап в игровое время t (целые мс, не раньше появления текущего блока).
 * Возвращает итог броска или null, если тап не принят (забег окончен, время идёт назад).
 */
export function drop(g: Game, t: number): DropResult | null {
  if (g.over || !Number.isFinite(t)) return null;
  t = Math.floor(t);
  if (t < g.spawnT) return null;
  const level = g.blocks.length;
  const cur: Block = { x: sliderX(g, t), w: g.w };
  const base = top(g);
  g.taps.push(t);

  const left = Math.max(cur.x, base.x);
  const right = Math.min(cur.x + cur.w, base.x + base.w);
  if (right <= left) {
    g.over = true;
    g.combo = 0;
    return { kind: "miss", drop: cur, placed: null, cut: cur, points: 0, combo: 0, level, t };
  }

  if (Math.abs(cur.x - base.x) <= CONFIG.PERFECT_TOL) {
    g.combo += 1;
    g.perfects += 1;
    g.bestCombo = Math.max(g.bestCombo, g.combo);
    const points = CONFIG.PTS_PERFECT + Math.min(g.combo - 1, CONFIG.COMBO_CAP);
    let placed: Block = { x: base.x, w: cur.w };
    if (g.combo >= CONFIG.REGROW_FROM) {
      const grow = Math.min(CONFIG.REGROW, CONFIG.W0 - placed.w);
      placed = { x: placed.x - (grow >> 1), w: placed.w + grow };
    }
    g.score += points;
    g.blocks.push(placed);
    spawn(g, t);
    return { kind: "perfect", drop: cur, placed, cut: null, points, combo: g.combo, level, t };
  }

  g.combo = 0;
  const placed: Block = { x: left, w: right - left };
  // свес: слева или справа от остатка
  const cut: Block = cur.x < base.x ? { x: cur.x, w: left - cur.x } : { x: right, w: cur.x + cur.w - right };
  g.score += CONFIG.PTS_DROP;
  g.blocks.push(placed);
  spawn(g, t);
  return { kind: "cut", drop: cur, placed, cut, points: CONFIG.PTS_DROP, combo: 0, level, t };
}

export interface ReplayResult {
  score: number;
  /** сколько блоков поставлено (без опоры) */
  height: number;
  perfects: number;
  bestCombo: number;
  over: boolean;
  /** сколько тапов из журнала принято (остальные после конца забега отброшены) */
  accepted: number;
}

/** Проиграть забег заново по seed, бустеру и журналу тапов — то же, что делает сервер при проверке */
export function replay(seed: number, taps: readonly number[], booster: Booster | null = null): ReplayResult {
  const g = newGame(seed, booster);
  for (const t of taps) if (drop(g, t) === null) break;
  return { score: g.score, height: g.blocks.length - 1, perfects: g.perfects, bestCombo: g.bestCombo, over: g.over, accepted: g.taps.length };
}
