import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

// Num заменён «шпионом»: видно, с «расшифровкой» ли рисуется значение
vi.mock("@/components/ui/index", async (orig) => {
  const mod = await orig<Record<string, unknown>>();
  return {
    ...mod,
    Num: ({ value, decode = true }: { value: string | number; decode?: boolean }) => (
      <span data-num={String(value)} data-decode={String(decode)} />
    ),
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clockSubscribers, subscribeSeconds } from "@/lib/clock";
import { formatLeft } from "@/lib/countdown";
import { Readout } from "@/components/ui";
import { Wheel } from "@/pages/Wheel";

afterEach(() => {
  vi.useRealTimers();
});

describe("общие секундные часы", () => {
  it("один таймер на всех подписчиков, тик ровно на границе секунды, без подписчиков — стоп", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00.400Z"));
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeSeconds(a);
    const offB = subscribeSeconds(b);
    expect(vi.getTimerCount()).toBe(1);
    expect(clockSubscribers()).toBe(2);
    vi.advanceTimersByTime(590); // ещё 12:00:00.990 — рано
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20); // перешли 12:00:01
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(a).toHaveBeenCalledTimes(4);
    offA();
    offB();
    expect(clockSubscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("formatLeft: чч:мм:сс, без отрицательных", () => {
    expect(formatLeft(12_656_000)).toBe("03:30:56");
    expect(formatLeft(-5)).toBe("00:00:00");
  });
});

const html = (node: React.ReactNode, seed: Record<string, unknown> = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData([k], v);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("отсчёт «Следующая через» не «перезагружается» каждую секунду", () => {
  it("Readout live — значение без «расшифровки» цифр", () => {
    expect(html(<Readout label="x" value="03:30:56" live />)).toContain('data-decode="false"');
    expect(html(<Readout label="x" value="12" />)).toContain('data-decode="true"');
  });
  it("карточка отметки на колесе рисует отсчёт как live", () => {
    const now = Date.now();
    const out = html(<Wheel />, {
      daily: {
        claimed_today: true, streak: 3, cycle_day: 3, check_date: "2026-10-30", rewards: [],
        next_claim_at: new Date(now + 3 * 3600e3).toISOString(), server_time: new Date(now).toISOString(),
      },
      wheel: { free_spins_per_day: 1, used_today: 1, left_today: 0, next_reset_at: new Date(now + 3 * 3600e3).toISOString() },
    });
    const m = /data-num="(\d\d:\d\d:\d\d)" data-decode="(\w+)"/.exec(out);
    expect(m?.[1]).toMatch(/^0[23]:\d\d:\d\d$/);
    expect(m?.[2]).toBe("false");
  });
});
