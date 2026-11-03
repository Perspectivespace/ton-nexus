import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { battleRoom } from "@/lib/arena/battle.fixture";
import { ArenaLobbyView, type ArenaLobbyViewProps } from "./Arena";
import { ArenaRoomView } from "./ArenaRoom";
import { ArenaRules } from "@/components/arena/ArenaRules";
import { roomScreen, type ArenaLobby, type ArenaRoom, type ArenaType } from "@/lib/arena/api";

const html = (n: ReactNode) => renderToStaticMarkup(<MemoryRouter>{n}</MemoryRouter>);
const A4: ArenaType = { type: "a4", seats: 4, board: 9, stake_nano: "100000000", prizes_nano: ["360000000"], pot_nano: "400000000", commission_bps: 1000, waiting: 2 };
const A8: ArenaType = { type: "a8", seats: 8, board: 11, stake_nano: "100000000", prizes_nano: ["500000000", "220000000"], pot_nano: "800000000", commission_bps: 1000, waiting: 5 };
const LOBBY: ArenaLobby = { types: [A4, A8], active_room_id: null, server_time: "2026-11-02T12:00:00Z", skew: 0 };
const noop = () => {};
const lobby = (p: Partial<ArenaLobbyViewProps> = {}) =>
  html(<ArenaLobbyView lobby={LOBBY} balance={1.5} sel="a4" onPick={noop} onJoin={noop} onRules={noop} joining={false} err={null} {...p} />);

const T0 = Date.parse("2026-11-02T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
function room(p: Partial<ArenaRoom> = {}): ArenaRoom {
  return {
    id: 7, type: "a4", status: "waiting", seats_total: 4, seats: [{ seat: 0, name: "@neo", is_me: true }, { seat: 1, name: "Kira", is_me: false }, null, null], taken: 2, my_seat: 0,
    stake_nano: "100000000", fill_deadline: iso(T0 + 134_000), started_at: null, finished_at: null, seed_hash: "ab12cd34ef567890", results: [], match: null,
    server_time: iso(T0), skew: 0, ...p,
  };
}
const roomHtml = (r: ArenaRoom, now = T0) =>
  html(
    <QueryClientProvider client={new QueryClient()}>
      <ArenaRoomView room={r} screen={roomScreen(r, now)} type={A4} battle="done" />
    </QueryClientProvider>,
  );

describe("лобби «Арены»", () => {
  it("две комнаты из API: призы, игроки, сколько ждут; деньги выбранной", () => {
    const h = lobby();
    expect(h.match(/class="ar-room( sel)?"/g)).toEqual(['class="ar-room sel"', 'class="ar-room"']);
    expect(h).toContain("Арена 4");
    expect(h).toContain("Арена 8");
    expect(h).toContain("0.36");
    expect(h).toContain("2 место · 0.22");
    expect(h).toContain("2/4 ждут");
    expect(h).toContain("5/8 ждут");
    expect(h).toContain("Комиссия 10%");
    expect(h).toContain("−0.04 TON");
    expect(h).toContain("Фонд · 4 × 0.1");
    expect(h).toContain("3:00");
    expect(h).toContain("Правила и выплаты");
    expect(h).toMatch(/<button[^>]*class="ui-btn primary lg block"[^>]*>Войти за <span class="ar-k">0.1 TON<\/span>/);
    expect(h).not.toContain("disabled");
  });

  it("баланса меньше ставки — «Не хватает 0.04 TON», кнопка выключена, ссылка на пополнение", () => {
    const h = lobby({ balance: 0.06 });
    expect(h).toContain("Не хватает 0.04 TON");
    expect(h).toContain('href="/wallet?topup=1"');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Войти за/);
  });

  it("сервер ответил 402 — то же сообщение и ссылка", () => {
    const h = lobby({ err: { status: 402, code: "insufficient_balance", message: "" } });
    expect(h).toContain("Не хватает TON на балансе");
    expect(h).toContain('href="/wallet?topup=1"');
  });

  it("уже в комнате — «Вернуться в комнату» вместо входа", () => {
    const h = lobby({ lobby: { ...LOBBY, active_room_id: 42 } });
    expect(h).toContain('href="/arena/42"');
    expect(h).toContain("Вернуться в комнату");
    expect(h).not.toContain("Войти за");
  });
});

describe("комната «Арены»", () => {
  it("ожидание: игроки, таймер набора, гнёзда, выход с возвратом", () => {
    const h = roomHtml(room(), T0 + 14_000);
    expect(h).toMatch(/class="ar-wait-cnt">2<small>\/4<\/small>/);
    expect(h).toContain("2:00");
    expect(h).toContain("Ждём игроков · 2 из 4");
    expect(h.match(/class="ar-sock[^"]*"/g)).toEqual(['class="ar-sock me"', 'class="ar-sock full"', 'class="ar-sock next"', 'class="ar-sock"']);
    expect(h).toContain("Выйти · вернуть 0.1 TON");
    expect(h).toContain("ab12cd…7890");
    expect(h).toContain("1м 0.36 TON");
    expect(h).toContain("ar-radar-sweep");
  });

  it("время вышло — «возвращаем ставку»; автовозврат — экран возврата", () => {
    expect(roomHtml(room(), T0 + 200_000)).toContain("Время вышло — возвращаем ставку");
    const h = roomHtml(room({ status: "refunded", seats: [null, null, null, null], taken: 0, my_seat: null }));
    expect(h).toContain("Комната не собралась");
    expect(h).toContain("ставка 0.1 TON вернулась на баланс");
    expect(h).toContain("Ещё раз");
    expect(h).toContain('href="/arena"');
  });

  it("вышел сам — экран выхода", () => {
    expect(roomHtml(room({ my_seat: null }))).toContain("Вы вышли из комнаты");
  });

  it("отсчёт 3 с: «Комната собрана», крупная цифра, выйти нельзя", () => {
    const full = room({ status: "running", started_at: iso(T0), taken: 4, seats: [0, 1, 2, 3].map((i) => ({ seat: i, name: `p${i}`, is_me: i === 2 })), my_seat: 2 });
    const h = roomHtml(full, T0 + 1200);
    expect(h).toContain("Комната собрана");
    expect(h).toMatch(/class="ar-cd"[^>]*>2<\/b>/);
    expect(h).toContain("Старт через <b>2</b>");
    expect(h).not.toContain("Выйти");
    expect(h).not.toContain("ar-sock next");
  });

  it("после отсчёта — экран боя; ушёл к итогам до конца — «Итоги придут сами» и «Досмотреть»", () => {
    const r = battleRoom({ turn: 2, current: { turn: 2, opens_at: iso(T0), deadline: iso(T0 + 10_000), ready_seats: [], my_plan: null } });
    const h = roomHtml(r, T0 + 2_000);
    expect(h).toContain('class="ar-bt"');
    expect(h).toContain("Готово");
    expect(h).not.toContain("Экран боя появится");
    const out = html(
      <QueryClientProvider client={new QueryClient()}>
        <ArenaRoomView room={r} screen={roomScreen(r, T0 + 2_000)} type={A4} battle="out" />
      </QueryClientProvider>,
    );
    expect(out).toContain("Бой идёт · ход 2");
    expect(out).toContain("Итоги и приз придут сюда сами");
    expect(out).toContain("Досмотреть");
  });

  it("бой закончился у меня на глазах — сначала поле с «Бой окончен», потом итоги", () => {
    const r = battleRoom({ phase: "finished", finished: true, current: null }, { status: "finished", results: [{ seat: 0, name: "@neo", place: 1, prize_nano: "360000000" }] });
    const live = html(
      <QueryClientProvider client={new QueryClient()}>
        <ArenaRoomView room={r} screen={roomScreen(r, T0)} type={A4} battle="live" />
      </QueryClientProvider>,
    );
    expect(live).toContain("Бой окончен");
    expect(live).toContain('class="ar-bt"');
    const done = roomHtml(r);
    expect(done).toContain("1 место · +0.36 TON");
    expect(done).not.toContain('class="ar-bt"');
  });

  it("перед боем идёт проверка версии — «Проверяем версию…» вместо поля", () => {
    const r = battleRoom();
    const out = html(
      <QueryClientProvider client={new QueryClient()}>
        <ArenaRoomView room={r} screen={roomScreen(r, T0 + 60_000)} type={A4} battle="live" checking />
      </QueryClientProvider>,
    );
    expect(out).toContain("Проверяем версию");
    expect(out).not.toContain("ar-cv");
  });

  it("итоги: места и призы, моя строка подсвечена", () => {
    const r = room({
      status: "finished",
      results: [
        { seat: 1, name: "Kira", place: 2, prize_nano: "0" },
        { seat: 0, name: "@neo", place: 1, prize_nano: "360000000" },
      ],
    });
    const h = roomHtml(r);
    expect(h).toContain("1 место · +0.36 TON");
    expect(h).toMatch(/<li class="me">/);
  });
});

describe("правила «Арены»", () => {
  it("легенда «Карта» — шесть образцов клеток, выплаты из лобби", () => {
    const h = renderToStaticMarkup(<ArenaRules types={[A4, A8]} />);
    expect(h).toContain("<h3>Карта</h3>");
    expect(h.match(/class="ar-lg"/g)).toHaveLength(6);
    expect(h.match(/<canvas[^>]*data-k="[a-z]+"/g)).toHaveLength(6);
    expect(h).toContain("урон издалека ×½");
    expect(h).toContain("Арена 8");
    expect(h).toContain("0.22");
    for (const t of ["Ход", "Бой", "Зона", "Выплаты"]) expect(h).toContain(`<h3>${t}</h3>`);
  });
});
