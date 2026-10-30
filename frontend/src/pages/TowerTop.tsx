import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorState, Panel, ScreenHeader, SkeletonCard, Tabs } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { closesOn, countdown, formatCountdown, monthPrepositional, monthTitle, mskMonth, prevMonth, spokenCountdown } from "@/lib/tower/month";
import { useTowerLeaderboard } from "@/api/hooks";
import type { TowerLeaderboard, TowerLeaderEntry } from "@/api/types";
import "@/styles/tower-top.css";

type Which = "cur" | "prev";
const TABS = [
  { value: "cur", label: "Этот месяц" },
  { value: "prev", label: "Прошлый" },
] as const;

const fmt = (n: number) => n.toLocaleString("ru-RU");
const ton = (s: string) => `${s} TON`;

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
  const prizes = useMemo(() => new Map((data.prizes ?? []).map((p) => [p.place, p.ton])), [data.prizes]);
  const top = data.entries.slice(0, 3);
  const rest = data.entries.slice(3);
  const me = data.me?.rank != null ? data.me : null;
  const meShown = data.entries.some((e) => e.is_me);
  const last = data.entries[data.entries.length - 1];
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
              <Step key={i} place={i + 1} e={top[i]} prize={prizes.get(i + 1)} />
            ))}
          </ol>
        )}

        <PrizeLine data={data} current={current} />
      </Panel>

      <p className="tt-rules ui-onbg">Лучший забег месяца · при равенстве выше тот, кто набрал раньше · хватит бесплатных попыток</p>

      {rest.length > 0 && (
        <Panel className="tt-list" aria-label="Места с 4-го">
          <ol>
            {rest.map((e) => (
              <Row key={e.rank} e={e} prize={prizes.get(e.rank)} />
            ))}
          </ol>
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
                  {current && last && me.score != null && last.score >= me.score ? (
                    <span className="tt-gap">
                      +{fmt(last.score + 1 - me.score)} до {last.rank}-го места
                    </span>
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

function Step({ place, e, prize }: { place: number; e?: TowerLeaderEntry; prize?: string }) {
  return (
    <li className={`tt-step p${place}${e?.is_me ? " me" : ""}${e ? "" : " free"}`} aria-label={e ? `${place}-е место: ${e.is_me ? "вы" : e.name}, ${e.score}` : `${place}-е место свободно`}>
      <span className="tt-medal" aria-hidden="true">
        {place}
      </span>
      <span className="tt-pname">{e ? (e.is_me ? "Вы" : e.name) : "свободно"}</span>
      <span className="tt-pscore">{e ? fmt(e.score) : "—"}</span>
      {prize ? <span className="tt-prize">{ton(prize)}</span> : null}
      <span className="tt-base" aria-hidden="true" />
    </li>
  );
}

function Row({ e, prize }: { e: TowerLeaderEntry; prize?: string }) {
  return (
    <li className={e.is_me ? "tt-row me" : "tt-row"}>
      <span className="tt-rank">{e.rank}</span>
      <span className="tt-name">{e.is_me ? "Вы" : e.name}</span>
      {prize ? <span className="tt-prize">{ton(prize)}</span> : null}
      <span className="tt-score">{fmt(e.score)}</span>
    </li>
  );
}

function PrizeLine({ data, current }: { data: TowerLeaderboard; current: boolean }) {
  if (!current) return <p className="tt-foot">Итоги закрытого месяца не меняются</p>;
  if (!data.prizes?.length) return <p className="tt-foot">Призы пока не назначены</p>;
  const enough = data.total_players >= data.min_participants;
  return (
    <p className="tt-foot prize">
      Призы {data.prizes.length === 1 ? "за 1-е место" : `за места 1–${data.prizes.length}`}
      {enough ? null : (
        <>
          {" "}
          · нужно от {fmt(data.min_participants)} игроков, сейчас {fmt(data.total_players)}
        </>
      )}
    </p>
  );
}

/** «До итогов 12 д 04:05:09» — тикает раз в секунду; на нуле перезапрашивает топ (начался новый месяц) */
export function MonthClock({ endsAt, now: fixed }: { endsAt: string; now?: number }) {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  const qc = useQueryClient();
  const c = countdown(endsAt, now);
  useEffect(() => {
    if (fixed != null || c.over) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [fixed, c.over]);
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
