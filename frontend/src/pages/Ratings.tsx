import { Fragment, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorState, Panel, ScreenHeader, SkeletonCard, Tag } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { IconChevron } from "@/components/icons";
import { KINDS, kindOf, type Kind } from "@/components/RatingLinks";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { friendJoinHint, friendRuleText, friendSoonText, plural, readFriendRule } from "@/lib/friendRule";
import { monthPrepositional, monthTitle } from "@/lib/tower/month";
import { useRating, useTowerLeaderboard } from "@/api/hooks";
import type { RatingBoard, RatingKind, RatingPeriod } from "@/api/types";
import { Board, PrizeMark, placesWord, prizeOf, ton } from "@/pages/TowerTop";
import "@/styles/tower-top.css";

/*
 * «Рейтинги» (/ratings?t=level|tasks|friends|tower&p=month|all&from=profile|tasks):
 * один экран на четыре топа. Язык топа Башни — пьедестал 2·1·3, список, закреплённое «моё место»;
 * у каждого топа свой акцент и значок. Вкладка «Башня» — тот же `Board`, что и /tower/top.
 */

/** Куда ведёт «назад» — откуда открыли рейтинги */
const BACK: Record<string, [string, string]> = {
  tasks: ["/tasks", "Заработок"],
  tower: ["/tower", "Башня"],
  profile: ["/wallet", "Профиль"],
};

const fmt = (n: number) => n.toLocaleString("ru-RU");
const players = (n: number) => `${fmt(n)} ${plural(n, "игрок", "игрока", "игроков")}`;
const tasksWord = (n: number) => plural(n, "задание", "задания", "заданий");

/** Единица значения строки: «ур.» (уровень), «XP» (опыт за месяц), «задания» */
export function unitOf(d: RatingBoard, n: number): string {
  if (d.kind === "level") return d.period === "all" ? "ур." : "XP";
  if (d.kind === "tasks") return tasksWord(n);
  return plural(n, "друг", "друга", "друзей");
}

/** Заголовок шапки топа */
export function boardTitle(d: RatingBoard): string {
  if (d.kind === "level") return d.period === "all" ? "Уровень аккаунта" : `Опыт · ${monthTitle(d.month).toLowerCase()}`;
  if (d.kind === "tasks") return d.period === "month" ? `Задания · ${monthTitle(d.month).toLowerCase()}` : "Задания · всё время";
  return "Друзья";
}

/** Как считается топ — одна строка под шапкой (у друзей — из настройки владельца) */
export function ruleText(d: RatingBoard): string {
  if (d.kind === "friends") return friendRuleText(readFriendRule(d.rule));
  if (d.kind === "level")
    return d.period === "all"
      ? "Уровень аккаунта · при равном уровне выше тот, у кого больше опыта"
      : `Опыт, набранный в ${monthPrepositional(d.month)} · при равенстве выше тот, кто набрал раньше`;
  return d.period === "month"
    ? `Принятые задания за ${monthTitle(d.month).toLowerCase()} · при равенстве выше тот, кто успел раньше`
    : "Все принятые задания · при равенстве выше тот, кто успел раньше";
}

/**
 * Подстрочник «моего места». Уровень за всё время — сколько опыта до следующего уровня.
 * С призами — какой приз сейчас или сколько добрать до последнего призового места; иначе — до места выше.
 */
export function gapText(d: RatingBoard): string | null {
  const me = d.me;
  if (!me) return null;
  if (d.kind === "level" && d.period === "all") {
    return me.xp_to_next ? `Ещё ${fmt(me.xp_to_next)} XP до ${me.value + 1}-го уровня` : null;
  }
  const p = d.prize;
  if (p && p.places > 0) {
    const mine = prizeOf(p.prizes, me.rank);
    if (mine) return `Приз сейчас ${ton(mine.ton)}`;
    if (p.cutoff_value != null) {
      const need = Math.max(1, p.cutoff_value + 1 - me.value);
      const last = p.prizes[p.prizes.length - 1];
      return `+${fmt(need)} ${unitOf(d, need)} до ${last.to_place}-го места · приз ${ton(last.ton)}`;
    }
  }
  if (me.rank === 1) return "Вы на первом месте";
  if (me.need && me.next_rank) return `Ещё ${fmt(me.need)} ${unitOf(d, me.need)} — и вы ${me.next_rank}-й`;
  return null;
}

/** Строка призов в шапке: фонд, места и что нужно для следующего места. Без призов — null. */
export function prizeText(d: RatingBoard): { main: string; sub?: string } | null {
  const p = d.prize;
  if (!p) return null;
  const fund = `Призовой фонд ${ton(p.budget_ton)}`;
  const need = p.next_place_at != null ? Math.max(1, p.next_place_at - p.participants) : 0;
  const who = (n: number) => `${fmt(n)} ${plural(n, "участник", "участника", "участников")}`;
  if (!p.places) {
    if (p.participants >= p.min_participants)
      return {
        main: fund,
        sub: `Фонда пока не хватает на призы от ${ton(p.min_prize_ton)}`,
      };
    return {
      main: fund,
      sub: `Призы — от ${who(p.min_participants)} · ещё ${who(need)}`,
    };
  }
  const sub =
    p.next_place_at != null
      ? `Ещё ${who(need)} — и мест станет ${p.places + 1}`
      : p.limited_by === "budget"
        ? `Больше мест фонд не даёт: приз от ${ton(p.min_prize_ton)}`
        : undefined;
  return { main: `${fund} · ${placesWord(p.places)}`, sub };
}

export default function Ratings() {
  const [sp, setSp] = useSearchParams();
  const t = sp.get("t");
  const kind = (KINDS.some((x) => x.k === t) ? t : "level") as Kind;
  const p = sp.get("p");
  const period: RatingPeriod | undefined = p === "all" || p === "month" ? p : undefined;
  const [backTo, backLabel] = BACK[sp.get("from") ?? "profile"] ?? BACK.profile;
  useScreenBack(backTo);
  const set = (k: Kind, per?: RatingPeriod) => {
    const n = new URLSearchParams(sp);
    n.set("t", k);
    if (per) n.set("p", per);
    else n.delete("p");
    setSp(n, { replace: true });
  };

  return (
    <div className="tt rt space-y-4" style={{ "--acc": kindOf(kind).acc } as CSSProperties}>
      <BackLink to={backTo} label={backLabel} />
      <ScreenHeader eyebrow="Контур" title="Рейтинги" />
      <div role="tablist" aria-label="Рейтинг" className="rt-switch">
        {KINDS.map(({ k, label, Icon, acc }) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className="rt-tile"
            style={{ "--acc": acc } as CSSProperties}
            onClick={() => {
              if (k !== kind) {
                haptic.select();
                set(k);
              }
            }}
          >
            <span className="rt-tic">
              <Icon size={18} />
            </span>
            <span className="rt-tl">{label}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={kindOf(kind).label}>
        {kind === "tower" ? <TowerTab /> : <RatingTab kind={kind} period={period} onPeriod={(per) => set(kind, per)} />}
      </div>
    </div>
  );
}

/** Башня — тот же топ, что /tower/top (тот же запрос и та же разметка); прошлые месяцы — там */
function TowerTab() {
  const lb = useTowerLeaderboard();
  return (
    <div className="space-y-4">
      {lb.isPending ? (
        <SkeletonCard lines={4} label="Загружаем топ" />
      ) : lb.isError ? (
        <ErrorState message="Не удалось загрузить топ" onRetry={() => void lb.refetch()} />
      ) : (
        <Board data={lb.data} current />
      )}
      <Link to="/tower/top" className="rt-more no-underline" onClick={() => haptic.tap()}>
        Прошлые месяцы и призы
        <IconChevron size={16} />
      </Link>
    </div>
  );
}

function PeriodSeg({ value, periods, onChange }: { value: RatingPeriod; periods: RatingPeriod[]; onChange: (p: RatingPeriod) => void }) {
  if (periods.length < 2) return <p className="rt-per-one">за всё время</p>;
  return (
    <div role="radiogroup" aria-label="Период" className="rt-per">
      {periods.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={p === value}
          onClick={() => {
            if (p !== value) {
              haptic.select();
              onChange(p);
            }
          }}
        >
          <span>{p === "month" ? "Месяц" : "Всё время"}</span>
        </button>
      ))}
    </div>
  );
}

function Value({ d, n }: { d: RatingBoard; n: number }) {
  return d.kind === "level" && d.period === "all" ? (
    <>
      <span className="rt-u">ур.</span>
      {fmt(n)}
    </>
  ) : (
    <>{fmt(n)}</>
  );
}

function RatingTab({ kind, period, onPeriod }: { kind: RatingKind; period?: RatingPeriod; onPeriod: (p: RatingPeriod) => void }) {
  const q = useRating(kind, period);
  if (q.isPending) return <SkeletonCard lines={4} label="Загружаем рейтинг" />;
  if (q.isError) return <ErrorState message="Не удалось загрузить рейтинг" onRetry={() => void q.refetch()} />;
  return <RatingView d={q.data} onPeriod={onPeriod} />;
}

/** Топ по готовым данным (отдельно от запроса — для тестов и лаборатории) */
export function RatingView({ d, onPeriod }: { d: RatingBoard; onPeriod: (p: RatingPeriod) => void }) {
  const { Icon } = kindOf(d.kind);
  const top = d.entries.slice(0, 3);
  const rest = d.entries.slice(3);
  const me = d.me;
  const meShown = d.entries.some((e) => e.is_me);
  const empty = !d.soon && d.entries.length === 0;
  const prize = prizeText(d);
  const groups = d.prize?.prizes ?? [];
  const lastPrize = groups.length ? groups[groups.length - 1].to_place : 0;
  const prizeAt = (rank: number) => {
    const g = prizeOf(groups, rank);
    return g ? { ton: g.ton } : undefined;
  };
  const rule = readFriendRule(d.rule);
  const gap = gapText(d);
  const sub = (e: RatingBoard["entries"][number]) => (d.kind === "level" && d.period === "all" ? (e.xp != null ? `${fmt(e.xp)} XP` : " ") : unitOf(d, e.value));

  return (
    <div className="space-y-4">
      <Panel level="hero" cut="l" lift="l2" className={d.soon ? "tt-hero rt-hero soon" : "tt-hero rt-hero"}>
        <div className="tt-head">
          <div className="min-w-0">
            <p className="rt-eyebrow">
              <span className="rt-badge">
                <Icon size={14} />
              </span>
              {boardTitle(d)}
            </p>
            <p className="tt-count">{d.soon ? "Откроется с приглашениями" : empty ? "Пока без игроков" : players(d.total_players)}</p>
          </div>
          {d.soon ? (
            <Tag tone="neutral" dot={false}>
              скоро
            </Tag>
          ) : (
            <PeriodSeg value={d.period} periods={d.periods} onChange={onPeriod} />
          )}
        </div>

        {empty ? (
          <div className="tt-empty">
            <p className="ui-h">{d.kind === "tasks" && d.period === "month" ? `В ${monthPrepositional(d.month)} заданий ещё не принимали` : "Пока никого"}</p>
            <p className="ui-sec">{d.kind === "tasks" ? "Первое принятое задание сразу займёт 1-е место" : "Первый, кто наберёт опыт, займёт 1-е место"}</p>
          </div>
        ) : (
          <ol className="tt-podium" aria-label="Первая тройка">
            {[1, 0, 2].map((i) => {
              const e = top[i];
              const place = i + 1;
              const pz = e ? prizeAt(place) : undefined;
              return (
                <li
                  key={i}
                  className={`tt-step p${place}${e?.is_me ? " me" : ""}${e ? "" : " free"}`}
                  aria-label={e ? `${place}-е место: ${e.is_me ? "вы" : e.name}, ${fmt(e.value)} ${unitOf(d, e.value)}` : `${place}-е место свободно`}
                >
                  <span className="tt-medal" aria-hidden="true">
                    {place}
                  </span>
                  <span className="tt-pname">{e ? (e.is_me ? "Вы" : e.name) : "свободно"}</span>
                  <span className="tt-pscore">{e ? <Value d={d} n={e.value} /> : "—"}</span>
                  {pz ? <PrizeMark m={pz} /> : <span className="rt-psub">{e ? sub(e) : " "}</span>}
                  <span className="tt-base" aria-hidden="true" />
                </li>
              );
            })}
          </ol>
        )}

        <div className={prize ? "tt-foot prize rt-foot" : "tt-foot rt-foot"}>
          <p>{d.soon ? friendSoonText(rule) : prize ? prize.main : ruleText(d)}</p>
          {prize?.sub ? <p className="tt-foot-sub">{prize.sub}</p> : null}
        </div>
      </Panel>

      {prize && !d.soon ? <p className="tt-rules ui-onbg">{ruleText(d)}</p> : null}

      {rest.length > 0 && (
        <Panel className="tt-list" aria-label="Места с 4-го">
          <ol>
            {rest.map((e) => {
              const pz = prizeAt(e.rank);
              return (
                <Fragment key={e.rank}>
                  {lastPrize > 0 && e.rank === lastPrize + 1 ? (
                    <li className="tt-band cut" aria-label="Ниже — без приза">
                      Ниже — без приза
                    </li>
                  ) : null}
                  <li className={e.is_me ? "tt-row me" : "tt-row"}>
                    <span className="tt-rank">{e.rank}</span>
                    <span className="tt-name">
                      {e.is_me ? "Вы" : e.name}
                      {d.kind === "level" && d.period === "all" && e.xp != null ? <span className="tt-gap rt-xp">{`${fmt(e.xp)} XP`}</span> : null}
                    </span>
                    {pz ? <PrizeMark m={pz} /> : null}
                    <span className="tt-score">
                      <Value d={d} n={e.value} />
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </Panel>
      )}

      {d.soon && (
        <Panel className="rt-soon">
          <p className="ui-h">Топ друзей ждёт приглашений</p>
          <p className="ui-sec mt-1">
            Приглашения пока не записываются. Как только реферальная программа заработает, здесь появятся настоящие места — без выдуманных цифр.
          </p>
          <p className="ui-sec mt-2">{friendJoinHint(rule)}.</p>
        </Panel>
      )}

      {me && !meShown && !d.soon && (
        <>
          <div className="tt-pin-gap" aria-hidden="true" />
          <div className="tt-pin" role="status">
            <div className="tt-row me">
              <span className="tt-rank">{fmt(me.rank)}</span>
              <span className="tt-name">
                Вы
                {gap ? <span className="tt-gap">{gap}</span> : null}
              </span>
              <span className="tt-score">
                <Value d={d} n={me.value} />
              </span>
            </div>
          </div>
        </>
      )}
      {!me && !d.soon && !empty && <JoinPin d={d} />}
    </div>
  );
}

/** «Вас нет в топе» — что сделать, чтобы попасть (у друзей — по условию из настроек) */
function JoinPin({ d }: { d: RatingBoard }) {
  const [hint, to, cta] =
    d.kind === "friends"
      ? [friendJoinHint(readFriendRule(d.rule)), "/tasks?tab=friends", "Позвать"]
      : d.kind === "tasks"
        ? ["Одно принятое задание — и вы в таблице", "/tasks", "Задания"]
        : ["Наберите опыт — и вы в таблице", "/tasks", "Задания"];
  return (
    <>
      <div className="tt-pin-gap" aria-hidden="true" />
      <div className="tt-pin" role="status">
        <div className="tt-row join">
          <span className="tt-name">
            Вас нет в топе
            <span className="tt-gap">{hint}</span>
          </span>
          <Link to={to} className="ui-btn primary no-underline" onClick={() => haptic.tap()}>
            {cta}
          </Link>
        </div>
      </div>
    </>
  );
}
