// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { promoErrorText } from "./PromoPanel";

describe("промокод: понятные ошибки", () => {
  it("неверный и «не вовремя» введённый код — один ответ, без подсказок о времени", () => {
    expect(promoErrorText(new ApiError(400, "invalid or inactive code"))).toBe("Код не принят");
    expect(promoErrorText(new Error("что-то ещё"))).toBe("Код не принят");
  });
  it("перебор, повтор, лимит, срок", () => {
    expect(promoErrorText(new ApiError(429, "too many attempts"))).toBe("Слишком много попыток. Попробуйте позже");
    expect(promoErrorText(new ApiError(400, "already redeemed"))).toBe("Этот код уже активирован на вашем аккаунте");
    expect(promoErrorText(new ApiError(400, "code fully used"))).toBe("Активации этого кода закончились");
    expect(promoErrorText(new ApiError(400, "code expired"))).toBe("Срок действия кода истёк");
  });
});
