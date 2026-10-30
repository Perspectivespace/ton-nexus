import { Fragment, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorState, Panel, ScreenHeader, SkeletonCard, Tabs } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { serverNow } from "@/lib/cityPhase";
import { useSecondTick } from "@/lib/clock";
import { closesOn, countdown, formatCountdown, monthPrepositional, monthTitle, mskMonth, prevMonth, spokenCountdown } from "@/lib/tower/month";
import { useTowerLeaderboard } from "@/api/hooks";
import type { TowerLeaderboard, TowerLeaderEntry, TowerPrize, TowerPrizeStatus } from "@/api/types";
import "@/styles/tower-top.css";

type Which = "cur" | "prev";
const TABS = [
  { value: "cur", label: "Этот месяц" },
  { value: "prev", label: "Прошлый" },
] as const;

const fmt = (n: number) => n.toLocaleString("ru-RU");
/** «0.2» → «0,2 TON» (как пишем суммы по-русски) */
export const ton = (s: string) => `${s.replace(".", ",")} TON`;

/** «51–100 место» / «7 место» */
export const placeRange = (g: TowerPrize) => (g.from_place === g.to_place ? `${g.from_place} место` : `${g.from_place}–${g.to_place} место`);

/** Приз места (или undefined). */
export function prizeOf(prizes: TowerPrize[] | null | undefined, place: number): TowerPrize | undefined {
  return prizes?.find((g) => g.from_place <= place && place <= g.to_place);
}

function players(n: number) {
  const a = n % 10;
  const b = n % 100;
  return `${fmt(n)} ${a === 1 && b !== 11 ? "игрок" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? "игрока" : "игроков"}`;
}

/**
 * Топ «Башни» за месяц (`/tower/top`, `?m=prev` — прошлый месяц): пьедестал первой тройки, места 4…N,
 * закреплённая строка «моё место», отсчёт до 00:00 МСК 1-го числа. Призы — только если владелец их включил.
 */
export default function TowerTop() {
  useScreenBack("/tower");
  // сервер прислал свои часы вместе с топом (hooks) — месяц и отсчёт считаем по ним
  const [sp, setSp] = useSearchParams();
  const which: Which = sp.get("m") === "prev" ? "prev" : "cur";
  const cur = mskMonth();
  const lb = useTowerLeaderboard(which === "prev" ? prevMonth(cur) : undefined);

  const pick = (v: Which) => setSp(v === "prev" ? { m: "prev" } : {}, { replace: true });

  return (
    <div className="tt space-y-4">
      <BackLink to="/tower" label="Башня" />
      <ScreenHeader eyebrow="Башня" title="Топ месяца" />
      <Tabs items={TABS} value={which} onChange={pick} label="Месяц топа" />
      {lb.isPending ? (
        <SkeletonCard lines={4} label="Загружаем топ" />
      ) : lb.isError ? (
        <ErrorState message="Не удалось загрузить топ" onRetry={() => void lb.refetch()} />
      ) : (
        <Board data={lb.data} current={which === "cur"} />
      )}
    </div>
  );
}

export function Board({ data, current, now }: { data: TowerLeaderboard; current: boolean; now?: number }) {
  const groups = data.prizes ?? [];
  // закрытый месяц: у призовых мест — сумма и статус выплаты из замороженных итогов
  const closed = !current && !!data.closed;
  const mark = (e?: TowerLeaderEntry, fallback?: string): Mark | undefined =>
    closed ? (e?.prize_ton ? { ton: e.prize_ton, status: e.prize_status } : undefined) : fallback ? { ton: fallback } : undefined;
  const lastPrize = groups.length ? groups[groups.length - 1].to_place : 0;
  const top = data.entries.slice(0, 3);
  const rest = data.entries.slice(3);
  const me = data.me?.rank != null ? data.me : null;
  const meShown = data.entries.some((e) => e.is_me);
  const lastShown = data.entries.length ? data.entries[data.entries.length - 1].rank : 0;
  // группы мест, которые ниже видимого списка: «51–100 место · 0,2 TON»
  const below = groups.filter((g) => g.to_place > Math.max(lastShown, 3));
  const empty = data.entries.length === 0;
  // закреплённая строка: «моё место» вне видимого топа или приглашение сыграть в текущем месяце
  const pin = me && !meShown ? "rank" : current && !me && !empty ? "join" : null;

  return (
    <>
      <Panel level="hero" cut="l" lift="l2" className="tt-hero">
        <div className="tt-head">
          <div className="min-w-0">
            <p className="ui-label">{monthTitle(data.month, now)}</p>
            <p className="tt-count">{empty ? (current ? "Пока без игроков" : "Без игроков") : players(data.total_players)}</p>
          </div>
          {current ? (
            <MonthClock endsAt={data.month_ends_at} now={now} />
          ) : (
            <div className="tt-clock-box">
              <p className="ui-label">Итоги</p>
              <p className="tt-closed">закрыт {closesOn(data.month)}</p>
            </div>
          )}
        </div>

        {empty ? (
          <div className="tt-empty">
            <p className="ui-h">{current ? "Пока никто не сыграл" : `В ${monthPrepositional(data.month)} никто не играл`}</p>
            {current ? (
              <>
                <p className="ui-sec">Первый забег месяца сразу займёт 1-е место</p>
                <Link to="/tower" className="ui-btn primary no-underline" onClick={() => haptic.tap()}>
                  Играть
                </Link>
              </>
            ) : null}
          </div>
        ) : (
          <ol className="tt-podium" aria-label="Первая тройка">
            {[1, 0, 2].map((i) => (
              <Step key={i} place={i + 1} e={top[i]} prize={mark(top[i], prizeOf(groups, i + 1)?.ton)} />
            ))}
          </ol>
        )}

        <PrizeLine data={data} current={current} />
      </Panel>

      {closed && groups.length > 0 ? (
        <p className="tt-legend ui-onbg" aria-hidden="true">
          <span className="tt-prize paid">
            <PrizeIcon status="paid" />
            выплачено
          </span>
          <span className="tt-prize awaiting">
            <PrizeIcon status="awaiting" />
            ждёт выплаты
          </span>
        </p>
      ) : (
        <p className="tt-rules ui-onbg">Лучший забег месяца · при равенстве выше тот, кто набрал раньше · хватит бесплатных попыток</p>
      )}

      {rest.length > 0 && (
        <Panel className="tt-list" aria-label="Места с 4-го">
          <ol>
            {rest.map((e, i) => {
              const g = prizeOf(groups, e.rank);
              const band = g && g.from_place !== g.to_place;
              // подпись группы — у её первого места (или у 4-го, если группа началась на пьедестале)
              const label = band && (e.rank === g.from_place || i === 0);
              const cut = lastPrize > 0 && e.rank === lastPrize + 1;
              return (
                <Fragment key={e.rank}>
                  {label ? <BandLabel g={g} /> : null}
                  {cut ? (
                    <li className="tt-band cut" aria-label="Ниже — без приза">
                      Ниже — без приза
                    </li>
                  ) : null}
                  <Row e={e} prize={mark(e, g && !band ? g.ton : undefined)} />
                </Fragment>
              );
            })}
          </ol>
        </Panel>
      )}

      {below.length > 0 && (
        <Panel className="tt-below" aria-label="Призы ниже">
          <p className="ui-label">Призы ниже</p>
          <ul>
            {below.map((g) => (
              <li key={g.from_place}>
                <span>{placeRange(g)}</span>
                <span className="tt-prize">{ton(g.ton)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {pin && (
        <>
          <div className="tt-pin-gap" aria-hidden="true" />
          <div className="tt-pin" role="status">
            {pin === "rank" && me ? (
              <div className="tt-row me">
                <span className="tt-rank">{me.rank}</span>
                <span className="tt-name">
                  Вы
                  {current ? (
                    <PinGap data={data} rank={me.rank ?? 0} score={me.score ?? 0} />
                  ) : closed && me.prize_ton ? (
                    <span className="tt-gap">{`Приз ${ton(me.prize_ton)} · ${STATUS_WORD[me.prize_status ?? "awaiting"]}`}</span>
                  ) : null}
                </span>
                <span className="tt-score">{fmt(me.score ?? 0)}</span>
              </div>
            ) : (
              <div className="tt-row join">
                <span className="tt-name">
                  Вас нет в топе
                  <span className="tt-gap">Один забег — и вы в таблице</span>
                </span>
                <Link to="/tower" className="ui-btn primary no-underline" onClick={() => haptic.tap()}>
                  Играть
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Подпись группы мест с одним призом: «11–20 место · 1,75 TON». */
function BandLabel({ g }: { g: TowerPrize }) {
  return (
    <li className="tt-band">
      <span>{placeRange(g)}</span>
      <span className="tt-prize">{ton(g.ton)}</span>
    </li>
  );
}

/**
 * Подстрочник «моего места»: ниже призов — сколько очков до последнего ПРИЗОВОГО места;
 * в призах — какой приз сейчас. Без призов ничего не обещаем.
 */
export function pinGapText(data: TowerLeaderboard, rank: number, score: number): string | null {
  const groups = data.prizes ?? [];
  if (!groups.length) return null;
  const last = groups[groups.length - 1];
  const mine = prizeOf(groups, rank);
  if (mine) return `Приз сейчас ${ton(mine.ton)}`;
  if (data.prize_cutoff_score == null) return null;
  const need = Math.max(1, data.prize_cutoff_score + 1 - score);
  return `+${fmt(need)} до ${last.to_place}-го места · приз ${ton(last.ton)}`;
}

function PinGap({ data, rank, score }: { data: TowerLeaderboard; rank: number; score: number }) {
  const t = pinGapText(data, rank, score);
  return t ? <span className="tt-gap">{t}</span> : null;
}

type Mark = { ton: string; status?: TowerPrizeStatus };

const STATUS_WORD: Record<TowerPrizeStatus, string> = { paid: "выплачено", awaiting: "ждёт выплаты", voided: "аннулирован" };

/** значок статуса приза: галочка — выплачено, часы — ждёт, черта — аннулирован (только stroke, без свечения) */
function PrizeIcon({ status }: { status: TowerPrizeStatus }) {
  return (
    <svg className="tt-picon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {status === "paid" ? (
        <path d="M2.5 6.2 5 8.6l4.6-5" />
      ) : status === "awaiting" ? (
        <>
          <circle cx="6" cy="6" r="4.2" />
          <path d="M6 3.6V6l1.7 1.1" />
        </>
      ) : (
        <path d="M2.5 6h7" />
      )}
    </svg>
  );
}

/** приз места: сумма; у закрытого месяца — со статусом выплаты */
export function PrizeMark({ m }: { m: Mark }) {
  return (
    <span className={m.status ? `tt-prize ${m.status}` : "tt-prize"}>
      {m.status ? <PrizeIcon status={m.status} /> : null}
      {ton(m.ton)}
      {m.status ? <span className="sr-only">{`, ${STATUS_WORD[m.status]}`}</span> : null}
    </span>
  );
}

function Step({ place, e, prize }: { place: number; e?: TowerLeaderEntry; prize?: Mark }) {
  return (
    <li className={`tt-step p${place}${e?.is_me ? " me" : ""}${e ? "" : " free"}`} aria-label={e ? `${place}-е место: ${e.is_me ? "вы" : e.name}, ${e.score}` : `${place}-е место свободно`}>
      <span className="tt-medal" aria-hidden="true">
        {place}
      </span>
      <span className="tt-pname">{e ? (e.is_me ? "Вы" : e.name) : "свободно"}</span>
      <span className="tt-pscore">{e ? fmt(e.score) : "—"}</span>
      {prize ? <PrizeMark m={prize} /> : null}
      <span className="tt-base" aria-hidden="true" />
    </li>
  );
}

function Row({ e, prize }: { e: TowerLeaderEntry; prize?: Mark }) {
  return (
    <li className={e.is_me ? "tt-row me" : "tt-row"}>
      <span className="tt-rank">{e.rank}</span>
      <span className="tt-name">{e.is_me ? "Вы" : e.name}</span>
      {prize ? <PrizeMark m={prize} /> : null}
      <span className="tt-score">{fmt(e.score)}</span>
    </li>
  );
}

export function placesWord(n: number) {
  const d = n % 10;
  const dd = n % 100;
  const w = dd >= 11 && dd <= 14 ? "призовых мест" : d === 1 ? "призовое место" : d >= 2 && d <= 4 ? "призовых места" : "призовых мест";
  return `${n} ${w}`;
}

/** Строка призов под пьедесталом: фонд, сколько мест сейчас и сколько игроков до следующего места. */
export function prizeLines(data: TowerLeaderboard, current: boolean): { main: string; sub?: string; on: boolean } {
  if (!current) return data.closed ? closedLines(data) : { main: "Итоги закрытого месяца не меняются", on: false };
  if (data.prizes == null || !data.prize_budget_ton) return { main: "Призы пока не назначены", on: false };
  const fund = `Призовой фонд ${ton(data.prize_budget_ton)}`;
  const have = data.participants ?? data.total_players;
  const next = data.next_place_at;
  const need = next != null ? Math.max(1, next - have) : 0;
  const n = data.prize_places ?? data.prizes.reduce((a, g) => Math.max(a, g.to_place), 0);
  if (!n) {
    if (have >= data.min_participants)
      return { main: fund, sub: `Фонда пока не хватает на призы от ${ton(data.min_prize_ton ?? "0")}`, on: true };
    return { main: fund, sub: `Призы — от ${players(data.min_participants)} · ещё ${players(need)}`, on: true };
  }
  const sub =
    next != null
      ? `Ещё ${players(need)} — и мест станет ${n + 1}`
      : data.prize_limited_by === "budget" && data.min_prize_ton
        ? `Больше мест фонд не даёт: приз от ${ton(data.min_prize_ton)}`
        : undefined;
  return { main: `${fund} · ${placesWord(n)}`, sub, on: true };
}

const NO_PRIZES: Record<string, string> = {
  disabled: "Призы в этом месяце не разыгрывались",
  no_budget: "Фонда не хватило на минимальный приз",
  no_players: "Призов не было",
};

/** Подпись закрытого месяца: фонд и места на момент закрытия, сколько уже выплачено. */
export function closedLines(data: TowerLeaderboard): { main: string; sub?: string; on: boolean } {
  const n = data.prize_places ?? 0;
  if (!data.prizes?.length || !n) {
    const why =
      data.close_reason === "few_participants"
        ? `Призов не было: меньше ${players(data.min_participants)}`
        : (NO_PRIZES[data.close_reason ?? ""] ?? "Призов не было");
    return { main: why, sub: "Итоги закрыты и не меняются", on: false };
  }
  const planned = data.prize_total_ton ?? "0";
  const paid = data.prize_paid_ton ?? "0";
  const waiting = Number(data.prize_awaiting_ton ?? 0) > 0;
  const sub = !waiting
    ? Number(paid) > 0
      ? `Призы выплачены · ${ton(paid)}`
      : "Призы аннулированы"
    : Number(paid) > 0
      ? `Выплачено ${ton(paid)} · ждут выплаты ${ton(data.prize_awaiting_ton ?? "0")}`
      : `${ton(data.prize_awaiting_ton ?? planned)} ждут выплаты`;
  return { main: `Фонд ${ton(data.prize_budget_ton ?? planned)} · ${placesWord(n)}`, sub, on: true };
}

function PrizeLine({ data, current }: { data: TowerLeaderboard; current: boolean }) {
  const l = prizeLines(data, current);
  return (
    <div className={l.on ? "tt-foot prize" : "tt-foot"}>
      <p>{l.main}</p>
      {l.sub ? <p className="tt-foot-sub">{l.sub}</p> : null}
    </div>
  );
}

/** «До итогов 12 д 04:05:09» — тикает раз в секунду; на нуле перезапрашивает топ (начался новый месяц) */
export function MonthClock({ endsAt, now: fixed }: { endsAt: string; now?: number }) {
  const qc = useQueryClient();
  const live = fixed == null && !countdown(endsAt, serverNow()).over;
  useSecondTick(live);
  const c = countdown(endsAt, fixed ?? serverNow());
  useEffect(() => {
    if (c.over && fixed == null) void qc.invalidateQueries({ queryKey: ["tower", "leaderboard"] });
  }, [c.over, fixed, qc]);
  return (
    <div className="tt-clock-box">
      <p className="ui-label">До итогов</p>
      <p className="tt-clock" aria-hidden="true">
        {c.over ? "подводим итоги" : formatCountdown(c)}
      </p>
      <span className="sr-only">{c.over ? "Подводим итоги месяца" : `До итогов ${spokenCountdown(c)}`}</span>
    </div>
  );
}
