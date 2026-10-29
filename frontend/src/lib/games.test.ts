import { describe, expect, it } from "vitest";
import { hasFreeSpin, towerLine, wheelLine } from "./games";

describe("кнопка «Игры» и шторка игр", () => {
  it("янтарная точка — только когда осталось бесплатное вращение", () => {
    expect(hasFreeSpin(undefined)).toBe(false);
    expect(hasFreeSpin(null)).toBe(false);
    expect(hasFreeSpin({ left_today: 0 })).toBe(false);
    expect(hasFreeSpin({ left_today: 1 })).toBe(true);
    expect(hasFreeSpin({ left_today: 3 })).toBe(true);
  });

  it("строка колеса: склонение, сброс в 00:00 мск, без данных", () => {
    expect(wheelLine({ left_today: 1 })).toEqual({ text: "1 бесплатное вращение", hot: true });
    expect(wheelLine({ left_today: 2 })).toEqual({ text: "2 бесплатных вращения", hot: true });
    expect(wheelLine({ left_today: 5 })).toEqual({ text: "5 бесплатных вращений", hot: true });
    expect(wheelLine({ left_today: 11 }).text).toBe("11 бесплатных вращений");
    expect(wheelLine({ left_today: 21 }).text).toBe("21 бесплатное вращение");
    expect(wheelLine({ left_today: 0 })).toEqual({ text: "Новые вращения в 00:00 мск", hot: false });
    expect(wheelLine(undefined)).toEqual({ text: "Ежедневные вращения", hot: false });
  });

  it("строка башни: рекорд месяца в очках или приглашение", () => {
    expect(towerLine(1240)).toBe("Рекорд месяца · 1240");
    expect(towerLine(0)).toBe("Сложи башню без промаха");
    expect(towerLine(null)).toBe("Сложи башню без промаха");
    expect(towerLine(undefined)).toBe("Сложи башню без промаха");
  });
});
