import { describe, expect, it } from "vitest";
import { friendJoinHint, friendRuleShort, friendRuleText, friendSoonText, plural, readFriendRule, type FriendRule } from "./friendRule";

const R = (min_level: number, min_tasks: number, need_both = false): FriendRule => ({ min_level, min_tasks, need_both });

describe("plural", () => {
  it.each([
    [1, "задание"],
    [2, "задания"],
    [4, "задания"],
    [5, "заданий"],
    [11, "заданий"],
    [12, "заданий"],
    [14, "заданий"],
    [20, "заданий"],
    [21, "задание"],
    [22, "задания"],
    [101, "задание"],
    [111, "заданий"],
  ])("%i → %s", (n, w) => expect(plural(n, "задание", "задания", "заданий")).toBe(w));
});

describe("тексты условия друга из настройки", () => {
  it("по умолчанию: 3-й уровень ИЛИ 20 заданий", () => {
    const r = R(3, 20);
    expect(friendRuleText(r)).toBe("Друзья, которые дошли до 3-го уровня или выполнили 20 заданий");
    expect(friendSoonText(r)).toBe("Будем считать друзей, которые дошли до 3-го уровня или выполнили 20 заданий");
    expect(friendJoinHint(r)).toBe("Друг засчитается, когда дойдёт до 3-го уровня или выполнит 20 заданий");
    expect(friendRuleShort(r)).toBe("3-й ур. или 20 заданий");
  });

  it("оба условия: И", () => {
    const r = R(5, 10, true);
    expect(friendRuleText(r)).toBe("Друзья, которые дошли до 5-го уровня и выполнили 10 заданий");
    expect(friendJoinHint(r)).toBe("Друг засчитается, когда дойдёт до 5-го уровня и выполнит 10 заданий");
    expect(friendRuleShort(r)).toBe("5-й ур. и 10 заданий");
  });

  it("только уровень (задания выключены) — «и/или» не важно", () => {
    for (const both of [false, true]) {
      const r = R(4, 0, both);
      expect(friendRuleText(r)).toBe("Друзья, которые дошли до 4-го уровня");
      expect(friendJoinHint(r)).toBe("Друг засчитается, когда дойдёт до 4-го уровня");
    }
  });

  it("только задания: правильные окончания", () => {
    expect(friendRuleText(R(0, 1))).toBe("Друзья, которые выполнили 1 задание");
    expect(friendRuleText(R(0, 3))).toBe("Друзья, которые выполнили 3 задания");
    expect(friendRuleText(R(0, 11))).toBe("Друзья, которые выполнили 11 заданий");
    expect(friendJoinHint(R(0, 21))).toBe("Друг засчитается, когда выполнит 21 задание");
    expect(friendRuleShort(R(0, 1000))).toBe(`${(1000).toLocaleString("ru-RU")} заданий`);
  });

  it("оба выключены — засчитывается сразу", () => {
    const r = R(0, 0, true);
    expect(friendRuleText(r)).toBe("Все приглашённые друзья");
    expect(friendSoonText(r)).toBe("Будем считать всех приглашённых друзей");
    expect(friendJoinHint(r)).toBe("Друг засчитается сразу после приглашения");
    expect(friendRuleShort(r)).toBe("Сразу, без условий");
  });

  it("уровень 1 у всех — как выключенное условие; битое значение — по умолчанию", () => {
    expect(friendRuleText(readFriendRule({ min_level: 1, min_tasks: 2, need_both: true }))).toBe("Друзья, которые выполнили 2 задания");
    expect(readFriendRule(null)).toEqual(R(3, 20));
    expect(readFriendRule({ min_level: -2, min_tasks: "x" })).toEqual(R(3, 20));
    expect(readFriendRule({ min_level: 12, min_tasks: 0, need_both: true })).toEqual(R(12, 0, true));
    expect(friendRuleText(R(12, 0))).toBe("Друзья, которые дошли до 12-го уровня");
  });
});
