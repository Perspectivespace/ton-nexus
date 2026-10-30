/**
 * Условие «друг засчитывается» (настройка владельца `friend_rule`) → все тексты для игроков.
 *
 * Единственное место, где из настройки собираются слова: шапка и подпись топа «Друзья»,
 * карточка «скоро», подсказка «Вас нет в топе» и живой предпросмотр в Экономике.
 * Меняет владелец уровень, число заданий, «и/или» или выключает условие — меняются все надписи.
 */

export type FriendRule = {
  /** 0 — условие по уровню выключено */
  min_level: number;
  /** 0 — условие по заданиям выключено */
  min_tasks: number;
  /** true — нужны оба включённых условия, false — любое */
  need_both: boolean;
};

export const FRIEND_RULE_DEFAULT: FriendRule = {
  min_level: 3,
  min_tasks: 20,
  need_both: false,
};

/** «1 задание · 2 задания · 5 заданий · 21 задание · 111 заданий» */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const fmt = (n: number) => n.toLocaleString("ru-RU");
const tasksN = (n: number) => `${fmt(n)} ${plural(n, "задание", "задания", "заданий")}`;
/** «3-го уровня»: у порядкового в родительном падеже окончание всегда «-го» */
const levelN = (n: number) => `${n}-го уровня`;

/** Привести настройку с сервера к виду, с которым работают тексты (битое значение — условие по умолчанию). */
export function readFriendRule(v: unknown): FriendRule {
  if (!v || typeof v !== "object") return FRIEND_RULE_DEFAULT;
  const o = v as Record<string, unknown>;
  const int = (x: unknown, d: number) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : d);
  const lvl = int(o.min_level, FRIEND_RULE_DEFAULT.min_level);
  return {
    // 1-й уровень есть у всех — то же, что «без условия»
    min_level: lvl <= 1 ? 0 : lvl,
    min_tasks: int(o.min_tasks, FRIEND_RULE_DEFAULT.min_tasks),
    need_both: o.need_both === true,
  };
}

type Tense = "past" | "future";

/** Условия глаголами: прошедшее мн. ч. («дошли… выполнили») или будущее ед. ч. («дойдёт… выполнит»). */
function clauses(r: FriendRule, t: Tense): string[] {
  const out: string[] = [];
  if (r.min_level > 1) out.push(`${t === "past" ? "дошли" : "дойдёт"} до ${levelN(r.min_level)}`);
  if (r.min_tasks > 0) out.push(`${t === "past" ? "выполнили" : "выполнит"} ${tasksN(r.min_tasks)}`);
  return out;
}

const join = (r: FriendRule, parts: string[]) => parts.join(r.need_both ? " и " : " или ");

/** Кто считается — для подписи топа и предпросмотра владельцу.
 *  «Друзья, которые дошли до 3-го уровня или выполнили 20 заданий» · без условий — «Все приглашённые друзья». */
export function friendRuleText(rule: FriendRule): string {
  const c = clauses(rule, "past");
  return c.length ? `Друзья, которые ${join(rule, c)}` : "Все приглашённые друзья";
}

/** Карточка «скоро»: «Будем считать друзей, которые дошли до 3-го уровня или выполнили 20 заданий». */
export function friendSoonText(rule: FriendRule): string {
  const c = clauses(rule, "past");
  return c.length ? `Будем считать друзей, которые ${join(rule, c)}` : "Будем считать всех приглашённых друзей";
}

/** Подсказка «Вас нет в топе»: «Друг засчитается, когда дойдёт до 3-го уровня или выполнит 20 заданий». */
export function friendJoinHint(rule: FriendRule): string {
  const c = clauses(rule, "future");
  return c.length ? `Друг засчитается, когда ${join(rule, c)}` : "Друг засчитается сразу после приглашения";
}

/** Короткая сводка для списка настроек: «3-й ур. или 20 заданий» · «3-й ур. и 20 заданий» · «Сразу». */
export function friendRuleShort(rule: FriendRule): string {
  const p: string[] = [];
  if (rule.min_level > 1) p.push(`${rule.min_level}-й ур.`);
  if (rule.min_tasks > 0) p.push(tasksN(rule.min_tasks));
  return p.length ? join(rule, p) : "Сразу, без условий";
}
