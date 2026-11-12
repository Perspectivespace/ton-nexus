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
import { fmtNum, getLang, t, tp } from "@/i18n";

type Which = "cur" | "prev";
const TABS = [
  { value: "cur", get label() { return t("tower.thisMonth"); } },
  { value: "prev", get label() { return t("tower.lastMonth"); } },
] as const;

const fmt = (n: number) => fmtNum(n);
/** «0.2» → «0,2 TON» по-русски, «0.2 TON» по-английски */
export const ton = (s: string) => `${getLang() === "ru" ? s.replace(".", ",") : s} TON`;

/** «51–100 место» / «7 место» */
export const placeRange = (g: TowerPrize) => (g.from_place === g.to_place ? t("tower.place", { fromPlace: g.from_place }) : t("tower.places", { fromPlace: g.from_place, toPlace: g.to_place }));

/** Приз места (или undefined). */
export function prizeOf(prizes: TowerPrize[] | null | undefined, place: number): TowerPrize | undefined {
  return prizes?.find((g) => g.from_place <= place && place <= g.to_place);
}

function players(n: number) {
  return `${fmt(n)} ${tp("ratings.players", n)}`;
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
      <BackLink to="/tower" label={t("games.tower")} />
      <ScreenHeader eyebrow={t("games.tower")} title={t("tower.monthTop")} />
      <Tabs items={TABS} value={which} onChange={pick} label={t("tower.topMonthLabel")} />
      {lb.isPending ? (
        <SkeletonCard lines={4} label={t("ratings.loadingTop")} />
      ) : lb.isError ? (
        <ErrorState message={t("ratings.topFailed")} onRetry={() => void lb.refetch()} />
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
            <p className="tt-count">{empty ? (current ? t("ratings.noPlayers") : t("tower.noPlayers")) : players(data.total_players)}</p>
          </div>
          {current ? (
            <MonthClock endsAt={data.month_ends_at} now={now} />
          ) : (
            <div className="tt-clock-box">
              <p className="ui-label">{t("tower.results")}</p>
              <p className="tt-closed">{t("tower.closed")}{" "}{closesOn(data.month)}</p>
            </div>
          )}
        </div>

        {empty ? (
          <div className="tt-empty">
            <p className="ui-h">{current ? t("tower.nobodyPlayed") : t("tower.nobodyIn", { month: monthPrepositional(data.month) })}</p>
            {current ? (
              <>
                <p className="ui-sec">{t("tower.firstRun")}</p>
                <Link to="/tower" className="ui-btn primary no-underline" onClick={() => haptic.tap()}>
                  {t("games.play")}</Link>
              </>
            ) : null}
          </div>
        ) : (
          <ol className="tt-podium" aria-label={t("ratings.podium")}>
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
            {t("tower.paid")}</span>
          <span className="tt-prize awaiting">
            <PrizeIcon status="awaiting" />
            {t("tower.awaiting")}</span>
        </p>
      ) : (
        <p className="tt-rules ui-onbg">{t("tower.rule")}</p>
      )}

      {rest.length > 0 && (
        <Panel className="tt-list" aria-label={t("ratings.from4")}>
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
                    <li className="tt-band cut" aria-label={t("ratings.noPrizeBelow")}>
                      {t("ratings.noPrizeBelow")}</li>
                  ) : null}
                  <Row e={e} prize={mark(e, g && !band ? g.ton : undefined)} />
                </Fragment>
              );
            })}
          </ol>
        </Panel>
      )}

      {below.length > 0 && (
        <Panel className="tt-below" aria-label={t("tower.prizesBelow")}>
          <p className="ui-label">{t("tower.prizesBelow")}</p>
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
                  {t("ratings.you")}{current ? (
                    <PinGap data={data} rank={me.rank ?? 0} score={me.score ?? 0} />
                  ) : closed && me.prize_ton ? (
                    <span className="tt-gap">{t("tower.myPrize", { prizeTon: ton(me.prize_ton), awaiting: STATUS_WORD[me.prize_status ?? "awaiting"] })}</span>
                  ) : null}
                </span>
                <span className="tt-score">{fmt(me.score ?? 0)}</span>
              </div>
            ) : (
              <div className="tt-row join">
                <span className="tt-name">
                  {t("ratings.notInTop")}<span className="tt-gap">{t("tower.oneRun")}</span>
                </span>
                <Link to="/tower" className="ui-btn primary no-underline" onClick={() => haptic.tap()}>
                  {t("games.play")}</Link>
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
  if (mine) return t("ratings.prizeNow", { ton: ton(mine.ton) });
  if (data.prize_cutoff_score == null) return null;
  const need = Math.max(1, data.prize_cutoff_score + 1 - score);
  return t("tower.toPrizePlace", { need: fmt(need), toPlace: last.to_place, ton: ton(last.ton) });
}

function PinGap({ data, rank, score }: { data: TowerLeaderboard; rank: number; score: number }) {
  const gap = pinGapText(data, rank, score);
  return gap ? <span className="tt-gap">{gap}</span> : null;
}

type Mark = { ton: string; status?: TowerPrizeStatus };

const STATUS_WORD: Record<TowerPrizeStatus, string> = { get paid() { return t("tower.paid"); }, get awaiting() { return t("tower.awaiting"); }, get voided() { return t("tower.voided"); } };

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
    <li className={`tt-step p${place}${e?.is_me ? " me" : ""}${e ? "" : " free"}`} aria-label={e ? t("tower.placeAria", { place, name: e.is_me ? t("ratings.youLower") : e.name, score: e.score }) : t("ratings.placeFree", { place })}>
      <span className="tt-medal" aria-hidden="true">
        {place}
      </span>
      <span className="tt-pname">{e ? (e.is_me ? t("ratings.you") : e.name) : t("ratings.free")}</span>
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
      <span className="tt-name">{e.is_me ? t("ratings.you") : e.name}</span>
      {prize ? <PrizeMark m={prize} /> : null}
      <span className="tt-score">{fmt(e.score)}</span>
    </li>
  );
}

export function placesWord(n: number) {
  return tp("tower.prizePlaces", n);
}

/** Строка призов под пьедесталом: фонд, сколько мест сейчас и сколько игроков до следующего места. */
export function prizeLines(data: TowerLeaderboard, current: boolean): { main: string; sub?: string; on: boolean } {
  if (!current) return data.closed ? closedLines(data) : { main: t("tower.closedFixed"), on: false };
  if (data.prizes == null || !data.prize_budget_ton) return { main: t("tower.noPrizesYet"), on: false };
  const fund = t("ratings.fund", { budgetTon: ton(data.prize_budget_ton) });
  const have = data.participants ?? data.total_players;
  const next = data.next_place_at;
  const need = next != null ? Math.max(1, next - have) : 0;
  const n = data.prize_places ?? data.prizes.reduce((a, g) => Math.max(a, g.to_place), 0);
  if (!n) {
    if (have >= data.min_participants)
      return { main: fund, sub: t("ratings.fundShort", { minPrizeTon: ton(data.min_prize_ton ?? "0") }), on: true };
    return { main: fund, sub: t("ratings.prizesFrom", { minParticipants: players(data.min_participants), need: players(need) }), on: true };
  }
  const sub =
    next != null
      ? t("ratings.morePlaces", { need: players(need), places: n + 1 })
      : data.prize_limited_by === "budget" && data.min_prize_ton
        ? t("ratings.noMorePlaces", { minPrizeTon: ton(data.min_prize_ton) })
        : undefined;
  return { main: `${fund} · ${placesWord(n)}`, sub, on: true };
}

const NO_PRIZES: Record<string, string> = {
  get disabled() { return t("tower.npDisabled"); },
  get no_budget() { return t("tower.npBudget"); },
  get no_players() { return t("tower.npNone"); },
};

/** Подпись закрытого месяца: фонд и места на момент закрытия, сколько уже выплачено. */
export function closedLines(data: TowerLeaderboard): { main: string; sub?: string; on: boolean } {
  const n = data.prize_places ?? 0;
  if (!data.prizes?.length || !n) {
    const why =
      data.close_reason === "few_participants"
        ? t("tower.npPlayers", { minParticipants: players(data.min_participants) })
        : (NO_PRIZES[data.close_reason ?? ""] ?? t("tower.npNone"));
    return { main: why, sub: t("tower.resultsClosed"), on: false };
  }
  const planned = data.prize_total_ton ?? "0";
  const paid = data.prize_paid_ton ?? "0";
  const waiting = Number(data.prize_awaiting_ton ?? 0) > 0;
  const sub = !waiting
    ? Number(paid) > 0
      ? t("tower.paidOut", { paid: ton(paid) })
      : t("tower.voidedAll")
    : Number(paid) > 0
      ? t("tower.paidAwaiting", { paid: ton(paid), prizeAwaitingTon: ton(data.prize_awaiting_ton ?? "0") })
      : t("tower.awaitingSum", { planned: ton(data.prize_awaiting_ton ?? planned) });
  return { main: t("tower.fundPlaces", { planned: ton(data.prize_budget_ton ?? planned), n: placesWord(n) }), sub, on: true };
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
      <p className="ui-label">{t("tower.untilResults")}</p>
      <p className="tt-clock" aria-hidden="true">
        {c.over ? t("tower.summing") : formatCountdown(c)}
      </p>
      <span className="sr-only">{c.over ? t("tower.summingMonth") : t("tower.untilResultsIn", { c: spokenCountdown(c) })}</span>
    </div>
  );
}
