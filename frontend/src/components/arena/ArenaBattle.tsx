/**
 * Экран боя «Арены»: поле на canvas (рендер прототипа, жетон D, поле v3), ввод плана тапами,
 * таймер хода 10 с, «Готово» по местам, лента, лёгкая анимация розыгрыша, выбывание и финал.
 * Состояние — опрос GET /state (useArenaRoom, ~1 с), план — POST /plan (черновик ready=false, «Готово» — ready=true).
 */
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ARMORS, MEDKIT_MAX, WEAPONS } from "@shared/arena/engine.js";
import { Button } from "@/components/ui/Button";
import { arenaKeys, useArenaPlan, useNow } from "@/lib/arena/hooks";
import { parseArenaError, type ArenaRoom } from "@/lib/arena/api";
import {
  applyView,
  checkDraft,
  badPlanText,
  draftFromApi,
  emptyDraft,
  initialBattle,
  isEmptyDraft,
  meOf,
  nameOf,
  outPlace,
  planErrorAction,
  planLine,
  planToApi,
  plannedPos,
  reachCells,
  sameDraft,
  tapCell,
  targetsOf,
  toggleMedkit,
  turnClock,
  zoneInfo,
  type BattleState,
  type Draft,
  type FeedItem,
} from "@/lib/arena/battle";
import { GLYPH, RARITY } from "@/lib/arena/swatch";
import { ArenaRenderer, reducedMotion } from "./board/renderer";
import { assignSigils } from "./board/tokens";
import { T, type DrawView } from "./board/types";

const MAX_W = 456;
/** строк ленты: минимум, который оставляем под поле, и максимум */
const FEED_MIN = 2, FEED_MAX_LINES = 4, FEED_LINE = 19;
const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
const DRAFT_DEBOUNCE = 300;

const FEED_I: Record<string, { d: string; stroke?: boolean }> = {
  hit: { d: "M3 12h7M14 12h7M12 3v7M12 14v7M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z", stroke: true },
  miss: { d: "M5 12h14", stroke: true },
  death: { d: "M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.4 3 5.5V19h2.2v-2h1.3v2h2v-2h1.3v2H16.5v-3c1.7-1.1 3-2.9 3-5.5A7.5 7.5 0 0 0 12 3zm-3 6.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm6 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z" },
  zone: { d: "M12 3l9 16H3zM11 9v5h2V9zm0 6.5v2h2v-2z" },
  "zone-shrink": { d: "M3 3h6v2H5v4H3zM15 3h6v6h-2V5h-4zM3 15h2v4h4v2H3zM19 15h2v6h-6v-2h4zM9 9h6v6H9z" },
  pick: { d: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 7.5L8 9.8v4.4l4 2.3 4-2.3V9.8z" },
  heal: { d: GLYPH.cross },
  bump: { d: "M4 11h6l-2-2 1.4-1.4L13.8 12l-4.4 4.4L8 15l2-2H4zM20 13h-2v-2h2z" },
};
function FeedIcon({ t }: { t: string }) {
  const i = FEED_I[t] ?? FEED_I.miss;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {i.stroke ? <path d={i.d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <path d={i.d} fill="currentColor" fillRule="evenodd" />}
    </svg>
  );
}

/** Запасной вид поля: canvas не поднялся. Сервер держит бой — перезагрузка безопасна */
export function BoardFallback({ h, children }: { h: number; children?: ReactNode }) {
  return (
    <div className="ar-map-fail" role="alert" style={{ minHeight: Math.max(160, h) }}>
      <b>Поле не отрисовалось</b>
      <p>Таймер и «Готово» работают: без поля ход — стоять на месте. Обновите экран — бой сохранится.</p>
      <Button kind="secondary" size="md" onClick={() => location.reload()}>
        Обновить
      </Button>
      {children}
    </div>
  );
}

/** Ошибка рендера внутри блока поля не роняет экран боя — только поле уходит в запасной вид */
class BoardBoundary extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    this.props.onError(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface ArenaBattleProps {
  room: ArenaRoom;
  /** бой окончен и показан — к итогам */
  onDone: () => void;
}

export function ArenaBattle({ room, onDone }: ArenaBattleProps) {
  const qc = useQueryClient();
  const plan = useArenaPlan(room.id);
  const [bs, setBs] = useState<BattleState>(() => applyView(initialBattle(), room));
  useEffect(() => setBs((s) => applyView(s, room)), [room]);
  const b = bs.board;
  const me = meOf(b);
  const match = room.match;
  const cur = match?.current ?? null;
  const turn = b?.turn ?? 0;

  // ── черновик плана текущего хода ──
  const [draft, setDraft] = useState<Draft>(() => draftFromApi(cur?.my_plan?.plan));
  const [locked, setLocked] = useState(() => !!cur?.my_plan?.ready);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [spectator, setSpectator] = useState(false);
  const [watch, setWatch] = useState(false);
  const sent = useRef<{ turn: number; key: string; ready: boolean } | null>(null);
  const draftTurn = useRef(turn);
  useEffect(() => {
    if (draftTurn.current === turn) return;
    draftTurn.current = turn;
    setDraft(draftFromApi(cur?.my_plan?.plan));
    setLocked(!!cur?.my_plan?.ready);
    setErr("");
    setNote("");
    sent.current = null;
  }, [turn, cur]);

  const now = useNow(!!b && !b.finished, 250);
  const clock = turnClock(cur, room.skew ?? 0, now);
  const countdown = clock.opensIn > 0;

  // ── анимация розыгрыша ──
  // anim считается в рендере (а не ставится эффектом): иначе новый ход успевает мелькнуть статичным кадром до розыгрыша
  const [animDone, setAnimDone] = useState(bs.animKey);
  // поле не отрисовалось (нет 2d-контекста, ошибка кадра): вместо canvas — запасной вид, таймер и «Готово» работают
  const [boardErr, setBoardErr] = useState(false);
  const anim = !boardErr && bs.animKey !== animDone && !!bs.prev && !!bs.board && !reducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  // блок поля: ref-колбэк — ResizeObserver цепляется, когда блок появился (первый кадр боя может прийти без поля)
  const wrap = useRef<HTMLDivElement | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const wrapRef = useCallback((el: HTMLDivElement | null) => {
    wrap.current = el;
    setWrapEl(el);
  }, []);
  const R = useRef<ArenaRenderer | null>(null);
  const [width, setWidth] = useState(0);
  // экран боя целиком в высоту окна: поле ужимается по высоте, лента показывает столько строк, сколько влезает
  const root = useRef<HTMLDivElement>(null);
  const feedEl = useRef<HTMLUListElement>(null);
  const [, setVh] = useState(0);
  useEffect(() => {
    const f = () => setVh(window.innerHeight);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  // fit.c — потолок клетки по высоте окна (0 — ещё не мерили), fit.lines — строк ленты
  const [fit, setFit] = useState<{ c: number; lines: number }>({ c: 0, lines: FEED_MAX_LINES });
  const cell = b ? Math.max(16, Math.min(Math.floor(Math.min(width || 334, MAX_W) / b.N), fit.c || Infinity)) : 0;

  const alive = !!me?.alive;
  const planning = alive && !locked && !b?.finished && !anim && !spectator;
  const view = useMemo((): DrawView | null => {
    if (!b) return null;
    const v: DrawView = { m: b, prev: null, meId: b.meId, t: null };
    if (planning && me) {
      v.reach = reachCells(b, me);
      v.plan = draft;
      v.medkit = draft.medkit;
      v.from = plannedPos(me, draft);
      v.targets = targetsOf(b, me, draft);
      v.attack = draft.attack != null ? (b.players.find((p) => p.id === draft.attack) ?? null) : null;
    } else if (me && locked && !b.finished) {
      // принято: план виден, но без подсветки досягаемости
      v.plan = draft;
      v.medkit = draft.medkit;
      v.from = plannedPos(me, draft);
      v.attack = draft.attack != null ? (b.players.find((p) => p.id === draft.attack) ?? null) : null;
    }
    return v;
  }, [b, me, draft, planning, locked]);

  const failBoard = useCallback((e: unknown) => {
    console.error("arena board", e);
    R.current?.stopShimmer();
    setBoardErr(true);
  }, []);

  // canvas: размер и спрайты — при смене ширины/поля
  useEffect(() => {
    const el = wrapEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      const w = Math.floor(es[0].contentRect.width);
      setWidth((o) => (Math.abs(o - w) >= 1 ? w : o));
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [wrapEl]);
  const setupKey = b ? `${b.N}:${cell}` : "";
  useEffect(() => {
    if (!b || !canvas.current || !over.current || !cell || boardErr) return;
    try {
      if (!R.current) {
        R.current = new ArenaRenderer(canvas.current, over.current);
        R.current.onError = failBoard;
      }
      R.current.setup(b, cell, Math.min(window.devicePixelRatio || 1, 2));
      R.current.startShimmer();
    } catch (e) {
      failBoard(e);
      return;
    }
    if (import.meta.env.DEV) (window as unknown as { __arenaPerf?: unknown }).__arenaPerf = R.current.perf;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupKey]);
  useEffect(() => () => R.current?.stopShimmer(), []);

  // розыгрыш: новый animKey → кадры до T.end, потом статичный кадр
  useEffect(() => {
    const key = bs.animKey;
    if (key === animDone) return;
    const r = R.current;
    if (!r || !bs.prev || !bs.board || reducedMotion() || boardErr) {
      setAnimDone(key);
      return;
    }
    const m = bs.board, prev = bs.prev;
    let raf = 0;
    const t0 = performance.now();
    const step = (nowT: number) => {
      const t = nowT - t0;
      if (t >= T.end) {
        setAnimDone(key);
        return;
      }
      try {
        r.draw({ m, prev, meId: m.meId, t });
      } catch (e) {
        setAnimDone(key);
        failBoard(e);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // только animKey: опрос того же хода (готовность) приносит новый объект доски — розыгрыш не должен перезапускаться
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bs.animKey]);
  // подгонка под высоту: все замеры не зависят от размера поля (верх поля, промежуток поле→лента, отступ под экраном) — без петли
  useIsoLayout(() => {
    const el = root.current, mp = wrap.current, fd = feedEl.current, main = el?.closest("main");
    if (!el || !mp || !fd || !main) return;
    const y = window.scrollY;
    const mr = mp.getBoundingClientRect(), fr = fd.getBoundingClientRect(), mn = main.getBoundingClientRect();
    const docH = document.documentElement.scrollHeight;
    const above = mr.top + y;
    const between = fr.top - mr.bottom;
    // под лентой: нижний отступ main (+ safe-area) и всё, что идёт после main; main тянется на свободное место — его высоту не берём
    const below = parseFloat(getComputedStyle(main).paddingBottom) + Math.max(0, docH - (mn.bottom + y));
    const vh = window.innerHeight;
    const N = b?.N || 9;
    // высота блока поля при клетке c: N·c + «стена» сверху (renderer: round(0.3c) + 3) + рамка 2 px
    const mapH = (c: number) => N * c + Math.round(c * 0.3) + 3 + 2;
    const avail = vh - above - between - below; // под поле + ленту
    const wC = Math.floor(Math.min(width || 334, MAX_W) / N);
    let c = wC;
    while (c > 16 && mapH(c) > avail - (FEED_MIN * FEED_LINE - 3)) c--;
    const lines = Math.max(1, Math.min(FEED_MAX_LINES, Math.floor((avail - mapH(c) + 3) / FEED_LINE)));
    setFit((o) => (o.c !== c || o.lines !== lines ? { c, lines } : o));
  });

  // статичный кадр
  useEffect(() => {
    if (anim || !view || !R.current || !cell || boardErr) return;
    try {
      R.current.draw(view);
    } catch (e) {
      failBoard(e);
    }
  }, [anim, view, cell, setupKey, boardErr, failBoard]);

  // ── отправка плана ──
  const send = useCallback(
    (d: Draft, ready: boolean) => {
      if (!b || !me || !cur) return;
      const key = JSON.stringify(planToApi(d));
      sent.current = { turn: cur.turn, key, ready };
      plan.mutate(
        { turn: cur.turn, plan: isEmptyDraft(d) ? null : planToApi(d), ready },
        {
          onSuccess: () => setNote(""),
          onError: (e) => {
            const a = planErrorAction(parseArenaError(e));
            sent.current = null;
            if (ready) setLocked(false);
            if (a.kind === "reset") {
              setDraft(emptyDraft());
              setErr(a.text);
            } else if (a.kind === "spectate") {
              setSpectator(true);
              setNote(a.text);
            } else if (a.kind === "refetch") {
              setNote(a.text);
              void qc.invalidateQueries({ queryKey: arenaKeys.room(room.id) });
            } else {
              // retry / keep — черновик остаётся, автосохранение повторит; «Готово» — снова нажать
              setNote(a.text);
            }
          },
        },
      );
    },
    [b, me, cur, plan, qc, room.id],
  );

  // автосохранение черновика (ready=false): сервер разыграет его по дедлайну, даже без «Готово»
  const serverDraft = useMemo(() => draftFromApi(cur?.my_plan?.plan), [cur?.my_plan?.plan]);
  useEffect(() => {
    if (!planning || !cur || cur.turn !== turn) return;
    const key = JSON.stringify(planToApi(draft));
    if (sent.current && sent.current.turn === cur.turn && sent.current.key === key) return;
    if (!sent.current && sameDraft(draft, serverDraft)) return;
    const wait = Math.max(DRAFT_DEBOUNCE, clock.opensIn + 60);
    const h = window.setTimeout(() => {
      if (checkDraft(b!, me, draft)) return;
      send(draft, false);
    }, wait);
    return () => window.clearTimeout(h);
    // clock.opensIn > 0 → ждём открытия хода
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, planning, cur?.turn, turn, countdown, note]);

  const onReady = () => {
    if (!b || !me) return;
    if (locked) {
      setLocked(false);
      send(draft, false);
      return;
    }
    const bad = checkDraft(b, me, draft);
    if (bad) {
      setErr(badPlanText(bad));
      return;
    }
    if (countdown) {
      setNote("Ход ещё не начался");
      return;
    }
    setErr("");
    setLocked(true);
    send(draft, true);
  };

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!planning || !b || !me || !R.current) return;
    const rc = e.currentTarget.getBoundingClientRect();
    const c = R.current.cellAt(e.clientX - rc.left, e.clientY - rc.top);
    if (!c) return;
    const r = tapCell(b, me, draft, c);
    setDraft(r.draft);
    setErr(r.err);
  };

  // финал: доиграть последний ход, показать «Бой окончен», затем итоги
  const finished = !!b?.finished;
  useEffect(() => {
    if (!finished || anim) return;
    const h = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(h);
  }, [finished, anim, onDone]);

  if (!b) {
    return (
      <div className="ar-bt">
        <p className="ar-note">Загружаем поле…</p>
      </div>
    );
  }

  const aliveN = b.players.filter((p) => p.alive).length;
  const zi = zoneInfo(b, me);
  const line = planLine({ b, me, d: draft, err, anim, locked, countdown });
  const ready = new Set(cur?.ready_seats ?? []);
  const sig = assignSigils(b.players, b.meId);
  const w = me ? WEAPONS[me.weapon] : null;
  const rc = me ? RARITY[me.weapon] : RARITY.fists;
  const apMax = me?.armor ? ARMORS[me.armor].ap : 60;
  // оверлей «Вы выбыли» прячется только на розыгрыш хода, где я выбыл (видно, как это случилось), а не мигает на каждом ходу
  const showOut = !!me && !me.alive && !finished && !watch && !(anim && me.deathTurn === b?.lastTurn?.turn);
  const tLow = clock.left <= 3 && !countdown;
  const feed: FeedItem[] = bs.feed.slice(0, fit.lines);

  // «Вы выбыли» / «Бой окончен» — и над полем, и над запасным видом: без них из боя не выйти к итогам
  const overlays = (
    <>
      {showOut ? (
        <div className="ar-out">
          <h2>Вы выбыли</h2>
          <p>
            {outPlace(b)} место · ход {me?.deathTurn ?? b.turn - 1}
          </p>
          <div className="ar-out-acts">
            <Button kind="secondary" size="md" onClick={() => setWatch(true)}>
              Досмотреть
            </Button>
            <Button kind="primary" size="md" onClick={onDone}>
              Итоги
            </Button>
          </div>
        </div>
      ) : null}
      {finished && !anim ? (
        <div className="ar-out fin">
          <h2>Бой окончен</h2>
          <Button kind="primary" size="md" onClick={onDone}>
            Итоги
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="ar-bt" ref={root} data-turn={b.turn} data-phase={finished ? "finished" : countdown ? "countdown" : "planning"}>
      <div className="ar-mtop">
        <div className="ar-mchip">
          <span className="ui-label">Ход</span>
          <b>{b.turn}</b>
        </div>
        <div className="ar-mchip">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
          <span className="ui-label">Живых</span>
          <b>
            {aliveN}/{b.players.length}
          </b>
        </div>
        <ul className="ar-pips" aria-label={`Готовы ${b.players.filter((p) => p.alive && ready.has(p.id)).length} из ${aliveN}`}>
          {b.players.map((p) => (
            <li
              key={p.id}
              className={`${ready.has(p.id) ? "on" : ""}${p.alive ? "" : " dead"}${p.id === b.meId ? " me" : ""}`}
              style={{ "--pc": sig.get(p.id)?.col ?? "#9AA4BA" } as React.CSSProperties}
              title={`${nameOf(b, p.id)}${p.alive ? (ready.has(p.id) ? ": готов" : ": думает") : ": выбыл"}`}
            />
          ))}
        </ul>
        <div className={`ar-tm${tLow ? " low" : ""}`} aria-label={`Осталось ${clock.left} с`}>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle className="trk" cx="24" cy="24" r="20" />
            <circle className="arc" cx="24" cy="24" r="20" pathLength="100" strokeDasharray="100" strokeDashoffset={finished ? 100 : 100 - clock.frac * 100} />
          </svg>
          <b>{finished ? "—" : countdown ? Math.ceil(clock.opensIn / 1000) : clock.left}</b>
          {locked && !finished ? <span className="lock">принято</span> : null}
        </div>
        <div className="ar-mzone">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3h6v2H5v4H3zM15 3h6v6h-2V5h-4zM3 15h2v4h4v2H3zM19 15h2v6h-6v-2h4zM9 9h6v6H9z" fill="currentColor" />
          </svg>
          {zi.closed ? (
            <span>
              Зона <b>закрыта</b> · {zi.next}
            </span>
          ) : (
            <span>
              Зона <b>{`${zi.size}×${zi.size}`}</b> · {zi.next}
            </span>
          )}
          {zi.me ? <span className={zi.me.out ? "danger" : "safe"}>{zi.me.text}</span> : null}
        </div>
      </div>

      <div className="ar-map" ref={wrapRef}>
        {boardErr ? (
          <BoardFallback h={b.N * cell + Math.round(cell * 0.3) + 3}>{overlays}</BoardFallback>
        ) : (
          <BoardBoundary onError={failBoard}>
            <div className="ar-map-in" style={{ width: R.current ? undefined : "100%" }}>
              <canvas ref={canvas} className="ar-cv" onPointerUp={onTap} aria-label="Поле боя" />
              <canvas ref={over} className="ar-cv-over" aria-hidden="true" />
              {overlays}
            </div>
          </BoardBoundary>
        )}
      </div>

      {me ? (
        <div className="ar-hud">
          <div className="ar-bars">
            <div className={`ar-bar${me.hp <= 35 ? " low" : ""}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" />
              </svg>
              <span className="tr">
                <i style={{ width: `${Math.max(0, me.hp)}%` }} />
              </span>
              <b>{me.hp}</b>
            </div>
            <div className="ar-bar ap">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={GLYPH.armor} fill="currentColor" />
              </svg>
              <span className="tr">
                <i style={{ width: `${Math.min(100, (me.ap / apMax) * 100)}%`, "--seg": `${(10 / apMax) * 100}%` } as React.CSSProperties} />
              </span>
              <b>{me.ap}</b>
            </div>
          </div>
          {w ? (
            <div className="ar-wpn" style={{ "--rc": rc, "--rg": rc + "33" } as React.CSSProperties}>
              <span className="w-i">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={GLYPH[me.weapon]} fill="currentColor" fillRule="evenodd" />
                </svg>
              </span>
              <span className="w-n">{w.name}</span>
              <span className="w-s">
                <span>
                  дальн. <b>{w.range}</b>
                </span>
                <span>
                  урон <b>{w.dmg}</b>
                </span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`ar-plan${line.err ? " err" : ""}`} role="status">
        <span className="tag">{line.tag}</span>
        <span>
          {line.parts.map((p, i) => (p.b ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
        </span>
      </div>
      {note ? <p className="ar-bt-note">{note}</p> : null}

      {me && me.alive && !finished && !spectator ? (
        <div className="ar-acts">
          <Button
            kind="secondary"
            size="lg"
            className={draft.medkit ? "on" : undefined}
            disabled={me.medkits <= 0 || locked || anim}
            onClick={() => {
              setDraft((d) => toggleMedkit(me, d));
              setErr("");
            }}
            aria-label={`Аптечка, ${me.medkits} из ${MEDKIT_MAX}`}
            aria-pressed={draft.medkit}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.6 4h2.8v6.6H20v2.8h-6.6V20h-2.8v-6.6H4v-2.8h6.6z" fill="currentColor" />
            </svg>
            <span className="ar-mono">
              {me.medkits}/{MEDKIT_MAX}
            </span>
          </Button>
          <Button
            kind="secondary"
            size="lg"
            disabled={locked || anim || isEmptyDraft(draft)}
            onClick={() => {
              setDraft(emptyDraft());
              setErr("");
            }}
          >
            Сброс
          </Button>
          <Button kind={locked ? "secondary" : "primary"} size="lg" disabled={anim} onClick={onReady}>
            {locked ? "Изменить" : "Готово"}
          </Button>
        </div>
      ) : null}

      <ul className="ar-feed" ref={feedEl}>
        {feed.length ? (
          feed.map((f) => (
            <li key={f.key} className={`${f.t}${f.mine ? " me" : ""}`}>
              <FeedIcon t={f.t} />
              <span className="t">{String(f.turn).padStart(2, "0")}</span>
              <span>{f.text}</span>
            </li>
          ))
        ) : (
          <li className="pick">
            <FeedIcon t="pick" />
            <span className="t">00</span>
            <span>Матч начался. Лут виден всем — первый ход спокойный</span>
          </li>
        )}
      </ul>
    </div>
  );
}
