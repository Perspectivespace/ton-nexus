/**
 * Owner-facing metadata for economy settings: Russian titles, explanations
 * (derived from backend services), field labels, units and validation.
 */

export type FieldKind = "ton" | "int" | "num" | "pct_bp" | "pct_frac" | "text";

export type FieldMeta = {
  label: string;
  kind: FieldKind;
  unit?: string;
  min?: number;
  max?: number;
  hint?: string;
  readOnly?: boolean;
};

export type SettingMeta = {
  title: string;
  short: string;
  about: string;
  fields?: Record<string, Partial<FieldMeta>>;
  /** Row-level lock: return true if a field in this row must stay read-only. */
  lockField?: (row: Record<string, unknown>, field: string) => boolean;
  /** Field used as a row title in arrays of objects. */
  rowTitle?: string;
  /** Show live "шанс ≈ x%" under each top-level weight field. */
  chanceHints?: boolean;
  summary?: (v: unknown) => string;
};

/** Technical keys the backend/frontend logic relies on — never editable, not shown. */
export const HIDDEN_KEYS = new Set(["id", "key", "code", "type"]);

export const STAT_RU: Record<string, string> = {
  power: "Мощность",
  capacity: "Ёмкость",
  acceleration: "Ускорение",
  luck: "Удача",
  stability: "Стабильность",
};

const COMMON: Record<string, FieldMeta> = {
  ton: { label: "Сумма", kind: "ton", unit: "TON", min: 0 },
  xp: { label: "Опыт", kind: "int", unit: "XP", min: 0, max: 100000 },
  focus: { label: "Фокус", kind: "int", unit: "шт.", min: 0, max: 100 },
  block: { label: "Запрет", kind: "int", unit: "шт.", min: 0, max: 100 },
  success_boost_bp: {
    label: "Бонус к успеху",
    kind: "pct_bp",
    unit: "%",
    min: 0,
    max: 95,
    hint: "Прибавка к шансу успеха усиления майнера",
  },
  weight: { label: "Вес", kind: "int", min: 0, max: 10000 },
  label: { label: "Название", kind: "text" },
};

const pctBp = (bp: unknown) => `${Number(bp) / 100}%`;
const statWeights: Record<string, Partial<FieldMeta>> = Object.fromEntries(
  Object.entries(STAT_RU).map(([k, label]) => [k, { label, kind: "int", min: 0, max: 10000 }]),
);
const statCaps: Record<string, Partial<FieldMeta>> = Object.fromEntries(
  Object.entries(STAT_RU).map(([k, label]) => [k, { label, kind: "int", unit: "ур.", min: 1, max: 999 }]),
);

export const SETTINGS: Record<string, SettingMeta> = {
  upgrade_base_cost: {
    title: "Цена попытки усиления",
    short: "Базовая стоимость одной попытки, TON",
    about:
      "Сколько TON списывается за одну попытку усиления майнера. Итоговая цена = эта сумма + надбавка × (сумма уровней всех 5 статов − 5). При неудачной попытке TON сгорают.",
    fields: { ton: { label: "Цена", min: 0 } },
  },
  upgrade_cost_scale: {
    title: "Надбавка к цене усиления",
    short: "Рост цены с уровнями статов",
    about:
      "На сколько TON дорожает попытка усиления за каждый уровень статов сверх стартовых (сумма уровней всех 5 статов минус 5).",
    fields: { per_total_levels: { label: "За 1 уровень", kind: "ton", unit: "TON", min: 0 } },
  },
  upgrade_type_weights: {
    title: "Шансы статов при усилении",
    short: "Какой стат выпадает при попытке",
    about:
      "При попытке усиления сначала случайно выбирается стат — по этим весам. Шанс стата = его вес / сумма весов. Стат, достигший мягкого потолка, не выпадает. «Фокус» умножает вес выбранного стата, «Запрет» исключает стат из выбора.",
    fields: statWeights,
    chanceHints: true,
  },
  upgrade_success_base_bp: {
    title: "Шанс успеха усиления",
    short: "Базовый и минимальный шанс",
    about:
      "Шанс, что попытка усиления удастся: базовый шанс − снижение за уровень × (уровень стата − 1) + бонусы игрока. Шанс не опускается ниже минимального и не поднимается выше 95%.",
    fields: {
      base: { label: "Базовый шанс", kind: "pct_bp", unit: "%", min: 0, max: 95 },
      min: { label: "Минимальный шанс", kind: "pct_bp", unit: "%", min: 0, max: 95 },
    },
    summary: (v) => {
      const o = v as Record<string, unknown>;
      return `${pctBp(o.base)} · мин. ${pctBp(o.min)}`;
    },
  },
  upgrade_success_decay_per_level_bp: {
    title: "Снижение шанса за уровень",
    short: "Чем выше стат, тем сложнее",
    about:
      "На сколько процентных пунктов падает шанс успеха за каждый уровень стата, который усиливается. Стабильность майнера смягчает снижение на 0,1% за каждый свой уровень выше первого, но не больше чем наполовину.",
    fields: { decay: { label: "Снижение", kind: "pct_bp", unit: "%", min: 0, max: 50 } },
  },
  soft_caps: {
    title: "Потолки статов",
    short: "Максимальный уровень каждого стата",
    about:
      "Уровень, после которого стат больше не выпадает при усилении. Когда все статы на потолке, усиление недоступно.",
    fields: statCaps,
  },
  focus_weight_bonus: {
    title: "Сила жетона «Фокус»",
    short: "Множитель веса выбранного стата",
    about:
      "Во сколько раз жетон «Фокус» увеличивает вес выбранного стата при попытке усиления. Жетон тратится за одну попытку.",
    fields: { multiplier: { label: "Множитель", kind: "num", unit: "×", min: 1, max: 20 } },
  },
  miner_session_hours: {
    title: "Длительность цикла майнера",
    short: "Сколько часов длится один цикл",
    about:
      "Базовая длительность цикла майнинга. После цикла майнер останавливается и ждёт, пока игрок заберёт добычу. Ускорение удлиняет цикл на 6% за каждый уровень, поэтому заходить нужно реже.",
    fields: { hours: { label: "Длительность", kind: "num", unit: "ч", min: 0.5, max: 168 } },
  },
  miner_base_rate: {
    title: "Скорость добычи",
    short: "TON в час на базовом майнере",
    about:
      "Сколько TON в час добывает майнер с Мощностью 1. Каждый уровень Мощности выше первого добавляет процент из «Прибавки за Мощность». Добыча за цикл = скорость × длительность цикла.",
    fields: { ton_per_hour: { label: "Скорость", kind: "ton", unit: "TON/ч", min: 0 } },
  },
  miner_power_mult: {
    title: "Прибавка за Мощность",
    short: "Рост скорости добычи за уровень",
    about:
      "На сколько процентов растёт скорость добычи за каждый уровень Мощности выше первого. Например, 8% при Мощности 3 дают +16%.",
    fields: { per_level: { label: "За 1 уровень", kind: "pct_frac", unit: "%", min: 0, max: 100 } },
  },
  miner_capacity_mult: {
    title: "Прибавка за Ёмкость",
    short: "Рост хранилища за уровень",
    about:
      "На сколько процентов растёт хранилище майнера за каждый уровень Ёмкости выше первого. Сейчас добыча за цикл не упирается в хранилище, поэтому на заработок эта настройка не влияет.",
    fields: { per_level: { label: "За 1 уровень", kind: "pct_frac", unit: "%", min: 0, max: 100 } },
  },
  success_boost_cap_bp: {
    title: "Потолок бонуса к успеху",
    short: "Сколько бонуса с колеса можно накопить",
    about:
      "Бонус «к успеху» с колеса копится от выигрыша к выигрышу, но не выше этого потолка. Весь накопленный бонус прибавляется к шансу следующей попытки усиления и тратится на ней — и при успехе, и при неудаче.",
    fields: { bp: { label: "Потолок", kind: "pct_bp", unit: "%", min: 0, max: 95 } },
  },
  task_platform_commission_bp: {
    title: "Комиссия платформы",
    short: "Процент сверх бюджета задания",
    about:
      "При публикации задания с автора списывается награда × количество мест плюс этот процент как комиссия платформы.",
    fields: { bp: { label: "Комиссия", kind: "pct_bp", unit: "%", min: 0, max: 100 } },
  },
  min_withdraw_ton: {
    title: "Минимальный вывод",
    short: "Наименьшая сумма заявки на вывод",
    about: "Заявку на вывод TON меньше этой суммы создать нельзя.",
    fields: { ton: { label: "Минимум", min: 0 } },
  },
  referral_reward: {
    title: "Реферальная награда",
    short: "Пока не используется",
    about:
      "Сейчас эта настройка в игре ни на что не влияет: начисление за приглашённых друзей ещё не подключено. Значение сохранится на будущее.",
    fields: { ton: { label: "Награда", min: 0 } },
  },
  daily_rewards: {
    title: "Ежедневная награда",
    short: "Награды за серию входов",
    about:
      "Награда за ежедневный вход. Серия растёт, если забирать награду каждый день подряд; пропуск дня сбрасывает её на день 1. Дни 4–6 получают награду дня 3, с 7-го дня — награду дня 7. TON идут на баланс, опыт повышает уровень аккаунта, Фокус — жетоны для усиления.",
    fields: {
      day_1: { label: "День 1" },
      day_2: { label: "День 2" },
      day_3: { label: "Дни 3–6" },
      day_7: { label: "День 7 и дальше" },
    },
    summary: (v) => {
      const o = v as Record<string, Record<string, unknown>>;
      const first = o.day_1?.ton;
      const last = o.day_7?.ton;
      return first != null && last != null ? `${first} → ${last} TON` : `${Object.keys(o).length} дн.`;
    },
  },
  xp_per_level: {
    title: "Опыт для уровня",
    short: "Кривая роста уровня аккаунта",
    about:
      "Сколько опыта нужно на следующий уровень аккаунта: база × рост^(уровень − 1). Опыт приходит из ежедневной награды, промокодов и заданий; уровень открывает задания с минимальным уровнем.",
    fields: {
      base: { label: "База", kind: "int", unit: "XP", min: 1, max: 100000 },
      growth: { label: "Рост за уровень", kind: "num", unit: "×", min: 1, max: 5 },
    },
  },
  prize_wheel: {
    title: "Колесо призов",
    short: "Вращения и шансы секторов",
    about:
      "Сколько бесплатных вращений в день и что выпадает. Шанс сектора = его вес / сумма весов; игроки видят эти шансы в окне «Шансы» на экране колеса. Сектор с весом 0 не выпадает (на колесе он остаётся). Если сумма весов 0, сервер крутит по весам по умолчанию. Награда начисляется сразу: TON на баланс, опыт, жетоны Фокус и Запрет для усиления, бонус к шансу успеха усиления (копится до потолка из «Потолка бонуса к успеху», тратится на следующей попытке). Набор секторов совпадает с колесом в игре, поэтому секторы нельзя добавлять или удалять.",
    rowTitle: "label",
    fields: {
      free_spins_per_day: { label: "Бесплатных вращений в день", kind: "int", unit: "шт.", min: 0, max: 50 },
      items: { label: "Секторы колеса" },
      label: { label: "Название", readOnly: true },
    },
    lockField: (row, field) => row.id === "nothing" && field !== "weight",
    summary: (v) => {
      const o = v as { free_spins_per_day?: unknown; items?: unknown[] };
      return `${o.free_spins_per_day ?? 0} вращ./день · ${o.items?.length ?? 0} секторов`;
    },
  },
};

export function fieldMeta(settingKey: string, field: string, sample: unknown): FieldMeta {
  const own = SETTINGS[settingKey]?.fields?.[field];
  const base: FieldMeta | undefined = COMMON[field];
  const inferred: FieldMeta = {
    label: field.replace(/_/g, " "),
    kind:
      typeof sample === "number"
        ? Number.isInteger(sample)
          ? "int"
          : "num"
        : typeof sample === "string" && /^\d+(\.\d+)?$/.test(sample)
          ? "ton"
          : "text",
  };
  return { ...inferred, ...base, ...own } as FieldMeta;
}

/** Shift decimal point in a non-negative decimal string (exact, no float noise). */
export function shiftDecimal(s: string, places: number): string {
  let [i, f = ""] = s.trim().split(".");
  if (places > 0) {
    f = f.padEnd(places, "0");
    i += f.slice(0, places);
    f = f.slice(places);
  } else if (places < 0) {
    const q = -places;
    i = i.padStart(q + 1, "0");
    f = i.slice(i.length - q) + f;
    i = i.slice(0, i.length - q);
  }
  i = i.replace(/^0+(?=\d)/, "");
  f = f.replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

/** Value → input string. */
export function toInput(m: FieldMeta, v: unknown): string {
  if (v == null) return "";
  if (m.kind === "pct_bp") return String(Number(v) / 100);
  if (m.kind === "pct_frac") return shiftDecimal(String(v), 2);
  return String(v);
}

const DEC = /^\d+(\.\d+)?$/;

/** Input string → typed value (keeps original JS type for decimals). Throws Russian error. */
export function fromInput(m: FieldMeta, raw: string, original: unknown): unknown {
  const s = raw.trim().replace(",", ".");
  const range = (n: number) => {
    if (m.min != null && n < m.min) throw new Error(`не меньше ${m.min}`);
    if (m.max != null && n > m.max) throw new Error(`не больше ${m.max}`);
  };
  switch (m.kind) {
    case "text":
      if (!s) throw new Error("не может быть пустым");
      return raw.trim();
    case "int": {
      if (!/^-?\d+$/.test(s)) throw new Error("нужно целое число");
      const n = Number(s);
      range(n);
      return n;
    }
    case "pct_bp": {
      if (!DEC.test(s)) throw new Error("нужно число");
      const n = Number(s);
      range(n);
      const bp = Math.round(n * 100);
      if (Math.abs(bp - n * 100) > 1e-6) throw new Error("не больше 2 знаков после запятой");
      return bp;
    }
    case "pct_frac": {
      if (!DEC.test(s)) throw new Error("нужно число");
      range(Number(s));
      const frac = shiftDecimal(s, -2);
      return typeof original === "number" ? Number(frac) : frac;
    }
    case "ton": {
      if (!DEC.test(s)) throw new Error("нужно число, например 0.001");
      if ((s.split(".")[1] ?? "").length > 9) throw new Error("не больше 9 знаков после точки");
      range(Number(s));
      return typeof original === "number" ? Number(s) : shiftDecimal(s, 0);
    }
    default: {
      if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error("нужно число");
      const n = Number(s);
      range(n);
      return typeof original === "string" ? s : n;
    }
  }
}

export function formatField(m: FieldMeta, v: unknown): string {
  const val = toInput(m, v);
  return m.unit ? `${val} ${m.unit}`.replace(" %", "%") : val;
}

/** Collapsed one-line summary of a setting value. */
export function summarize(key: string, v: unknown): string {
  const meta = SETTINGS[key];
  try {
    if (meta?.summary) return meta.summary(v);
  } catch {
    /* fall through to generic */
  }
  if (v == null) return "—";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return `${v.length} шт.`;
  const entries = Object.entries(v as Record<string, unknown>).filter(([k]) => !HIDDEN_KEYS.has(k));
  if (!entries.length) return "—";
  return entries
    .map(([k, x]) => {
      if (x !== null && typeof x === "object") return `${fieldMeta(key, k, x).label}: …`;
      const m = fieldMeta(key, k, x);
      const val = formatField(m, x);
      return entries.length === 1 ? val : `${m.label} ${val}`;
    })
    .join(" · ");
}
