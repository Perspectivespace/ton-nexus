import { pluralIndex, t, tp } from "@/i18n";
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

/** «1 задание · 2 задания · 5 заданий» — tp из @/i18n; оставлено для старых импортов */
export function plural(n: number, one: string, few: string, many: string): string {
  const i = pluralIndex(n, "ru");
  return i === 0 ? one : i === 1 ? few : many;
}

const tasksN = (n: number) => tp("friend.tasks", n);

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

/** Условия глаголами: прошедшее («дошли… выполнили» / «reached… completed») или будущее («дойдёт… выполнит» / «reach… complete»). */
function clauses(r: FriendRule, tense: Tense): string[] {
  const out: string[] = [];
  if (r.min_level > 1) out.push(t(tense === "past" ? "friend.reachedLevel" : "friend.reachLevel", { n: r.min_level }));
  if (r.min_tasks > 0) out.push(t(tense === "past" ? "friend.completed" : "friend.complete", { tasks: tasksN(r.min_tasks) }));
  return out;
}

const join = (r: FriendRule, parts: string[]) => parts.join(t(r.need_both ? "friend.and" : "friend.or"));

/** Кто считается — для подписи топа и предпросмотра владельцу.
 *  «Друзья, которые дошли до 3-го уровня или выполнили 20 заданий» · без условий — «Все приглашённые друзья». */
export function friendRuleText(rule: FriendRule): string {
  const c = clauses(rule, "past");
  return c.length ? t("friend.who", { cond: join(rule, c) }) : t("friend.all");
}

/** Карточка «скоро»: «Будем считать друзей, которые дошли до 3-го уровня или выполнили 20 заданий». */
export function friendSoonText(rule: FriendRule): string {
  const c = clauses(rule, "past");
  return c.length ? t("friend.soon", { cond: join(rule, c) }) : t("friend.soonAll");
}

/** Подсказка «Вас нет в топе»: «Друг засчитается, когда дойдёт до 3-го уровня или выполнит 20 заданий». */
export function friendJoinHint(rule: FriendRule): string {
  const c = clauses(rule, "future");
  return c.length ? t("friend.joinHint", { cond: join(rule, c) }) : t("friend.joinNow");
}

/** Короткая сводка для списка настроек: «3-й ур. или 20 заданий» · «3-й ур. и 20 заданий» · «Сразу». */
export function friendRuleShort(rule: FriendRule): string {
  const p: string[] = [];
  if (rule.min_level > 1) p.push(t("friend.lvlShort", { n: rule.min_level }));
  if (rule.min_tasks > 0) p.push(tasksN(rule.min_tasks));
  return p.length ? join(rule, p) : t("friend.noCondition");
}
