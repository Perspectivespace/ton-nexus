import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Panel, ScreenHeader, Button, Num } from "@/components/ui";
import { IconChevron, IconPodium } from "@/components/icons";
import { prefetchRoute } from "@/lib/routes";
import { BackLink } from "@/components/BackLink";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { isFpsOn } from "@/lib/fps";
import * as engine from "@/lib/tower/engine";
import { TowerRun } from "@/lib/tower/runtime";
import { isFinal, parseTowerError, untilReset, type TowerErr } from "@/lib/tower/api";
import { useTowerFinish, useTowerMe, useTowerStart } from "@/api/hooks";
import type { TowerFinish } from "@/api/types";
import "@/styles/tower.css";
import { t } from "@/i18n";

type Phase = "idle" | "play" | "over";

interface Summary {
  score: number;
  height: number;
  perfects: number;
  bestCombo: number;
}

/** запись результата на сервере: идёт / записан / не записан (можно повторить, если сбой был не по вине журнала) */
type Saved =
  | { state: "saving" }
  | { state: "done"; res: TowerFinish }
  | { state: "failed"; err: TowerErr };

interface Pending {
  game_id: number;
  taps: number[];
  score: number;
}

/**
 * «Башня». Блок скользит над башней, тап роняет его, свес отрезается; идеальный бросок — бонус и серия.
 * Игровая логика — lib/tower/engine.ts (чистая, по seed и журналу тапов), отрисовка — lib/tower/runtime.ts
 * (один canvas, один rAF, стоит в простое и при свёрнутом приложении).
 * Попытки, seed и рекорд — на сервере: старт списывает попытку и выдаёт seed, по окончании уходит журнал тапов,
 * сервер проигрывает его тем же движком и сохраняет проверенный счёт.
 */
export default function Tower() {
  useScreenBack("/");
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef<TowerRun | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [sum, setSum] = useState<Summary | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [startErr, setStartErr] = useState<TowerErr | null>(null);
  const gameId = useRef(0);
  const pending = useRef<Pending | null>(null);

  const me = useTowerMe();
  const startM = useTowerStart();
  const finishM = useTowerFinish();
  const st = me.data;
  const best = st?.best_month ?? 0;
  const left = st?.left_today ?? null;
  const outOfAttempts = left === 0;

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const finish = useCallback(
    (p: Pending) => {
      pending.current = p;
      setSaved({ state: "saving" });
      finishM.mutate(p, {
        onSuccess: (res) => {
          pending.current = null;
          setSaved({ state: "done", res });
        },
        onError: (e) => {
          const err = parseTowerError(e);
          if (isFinal(err)) pending.current = null;
          setSaved({ state: "failed", err });
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishM.mutate]
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const r = new TowerRun(canvas.current!, {
      onDrop(res, g) {
        // лёгкий отклик на каждый бросок, «успех» — на идеальный
        haptic.impact("light");
        if (res.kind === "perfect") haptic.success();
        setScore(g.score);
        setCombo(g.combo);
        setDropped(g.blocks.length - 1);
      },
      onOver(g) {
        setSum({ score: g.score, height: g.blocks.length - 1, perfects: g.perfects, bestCombo: g.bestCombo });
        finishRef.current({ game_id: gameId.current, taps: [...g.taps], score: g.score });
        // небольшая пауза, чтобы упавший блок был виден до итога, а случайный тап не перезапустил игру
        window.setTimeout(() => {
          if (phaseRef.current === "play") {
            setPhase("over");
            r.sheet(true);
          }
        }, 650);
      },
    });
    run.current = r;
    // лаборатория: при включённом счётчике FPS отдаём забег и движок снаружи — тестовый бот играет, пока меряем кадры
    if (isFpsOn()) (window as { __tower?: unknown }).__tower = { run: r, engine };
    r.idle();
    return () => {
      r.destroy();
      run.current = null;
      delete (window as { __tower?: unknown }).__tower;
    };
  }, [setPhase]);

  const play = useCallback(async () => {
    if (startM.isPending) return;
    setStartErr(null);
    try {
      const r = await startM.mutateAsync();
      gameId.current = r.game_id;
      setScore(0);
      setCombo(0);
      setDropped(0);
      setSum(null);
      setSaved(null);
      setPhase("play");
      run.current?.start(r.seed, r.booster === "slow" || r.booster === "aim" ? r.booster : null);
    } catch (e) {
      // 409 «попыток нет»: экран перерисуется по свежему статусу и покажет сообщение; прочие сбои — строка ошибки
      const err = parseTowerError(e);
      if (err.code !== "no_attempts") setStartErr(err);
      else setPhase("idle");
    }
  }, [setPhase, startM]);

  // клавиатура (десктоп): пробел / Enter — бросок
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== "play" || e.repeat) return;
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        run.current?.tap(e.timeStamp);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const done = saved?.state === "done" ? saved.res : null;
  const shownScore = done ? done.score : (sum?.score ?? 0);
  const record = !!done?.new_best;

  return (
    <div className="space-y-4">
      <BackLink />
      <ScreenHeader
        eyebrow={t("tower.game")}
        title={t("games.tower")}
        action={
          <Link to="/tower/top" className="tw-top" onClick={() => haptic.tap()} onPointerEnter={() => void prefetchRoute("/tower/top")}>
            <IconPodium size={16} />
            {best > 0 ? <>{t("tower.topDot")}{" "}{best}</> : t("tower.monthTop")}
            <IconChevron size={14} />
          </Link>
        }
      />

      <Panel level="e1" cut="l" lift="l2" className="overflow-hidden !p-0">
        <div
          ref={stage}
          className="tw-stage"
          onPointerDown={(e) => {
            if (phaseRef.current === "play") {
              e.preventDefault();
              run.current?.tap(e.timeStamp);
            }
          }}
        >
          <canvas ref={canvas} aria-label={t("tower.fieldAria")} role="img" />

          {phase !== "idle" && (
            <div className="tw-plate" data-lv={combo >= 2 ? Math.min(combo, 6) : undefined} aria-live="off">
              <Num value={score} size="l" decode={false} className="!text-[28px] !leading-[32px]" />
              {combo >= 2 && (
                <span key={combo} className="tw-combo" data-lv={Math.min(combo, 6)}>
                  ×{combo}{" "}{t("tower.perfect")}</span>
              )}
            </div>
          )}

          {phase === "play" && dropped === 0 && <div className="tw-hint">{t("tower.tapDrop")}</div>}

          {phase === "idle" && (
            <div className="tw-sheet space-y-3">
              <div>
                <p className="ui-label">{t("games.tower")}</p>
                <p className="ui-sec mt-1">{t("tower.rules")}</p>
              </div>
              {st ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="ui-sys">{t("tower.monthBest")}{" "}{best}</span>
                  <span className="ui-sys">
                    {t("tower.tries")}{" "}{st.left_today}/{st.free_per_day}
                  </span>
                </div>
              ) : null}
              {outOfAttempts && <OutOfAttempts resetAt={st?.next_reset_at} />}
              {startErr && <p className="ui-sec text-[var(--danger-text)]" role="alert">{startErr.message || t("tower.startFailed")}</p>}
              {me.isError && !st && (
                <p className="ui-sec text-[var(--danger-text)]" role="alert">
                  {t("tower.triesFailed")}</p>
              )}
              {!outOfAttempts && (
                <div className="ui-spill">
                  {me.isError && !st ? (
                    <Button kind="primary" size="lg" block onClick={() => me.refetch()}>
                      {t("ui.retry")}</Button>
                  ) : (
                    <Button kind="primary" size="lg" block onClick={play} disabled={!st || startM.isPending}>
                      {startM.isPending ? t("tower.starting") : t("games.play")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === "over" && sum && (
            <div className="tw-sheet space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="ui-label">{record ? t("tower.newBest") : t("tower.gameOver")}</p>
                  <Num value={shownScore} size="xl" decode={false} tone={record ? "amber" : undefined} className="mt-1 block !text-[40px] !leading-[44px]" />
                </div>
                <div className="space-y-0.5 text-right">
                  <p className="ui-sys">{t("tower.monthBest")}{" "}{done ? done.best_month : best}</p>
                  {done?.rank != null && <p className="ui-sys">{t("tower.topPlace")}{" "}{done.rank}</p>}
                  <p className="ui-sys">{t("tower.blocks")}{" "}{sum.height}</p>
                  <p className="ui-sys">{t("tower.perfects")}{" "}{sum.perfects}{" "}{t("tower.streak")}{" "}{sum.bestCombo}</p>
                </div>
              </div>
              {saved?.state === "saving" && <p className="ui-sys">{t("tower.checking")}</p>}
              {saved?.state === "failed" && (
                <p className="ui-sec text-[var(--danger-text)]" role="alert">
                  {saved.err.code === "network" || !isFinal(saved.err) ? t("tower.notSaved") : saved.err.message || t("tower.notCounted")}
                </p>
              )}
              {saved?.state === "failed" && pending.current && (
                <Button kind="secondary" size="lg" block onClick={() => finish(pending.current!)}>
                  {t("tower.resend")}</Button>
              )}
              {outOfAttempts && saved?.state !== "saving" && <OutOfAttempts resetAt={st?.next_reset_at} />}
              {!outOfAttempts && saved?.state !== "saving" && !pending.current && (
                <div className="ui-spill">
                  <Button kind="primary" size="lg" block onClick={play} disabled={startM.isPending}>
                    {startM.isPending ? t("tower.starting") : t("tower.again", { left: left ?? 0 })}
                  </Button>
                </div>
              )}
              {startErr && <p className="ui-sec text-[var(--danger-text)]" role="alert">{startErr.message || t("tower.startFailed")}</p>}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

/** Попытки на сегодня закончились. Покупки пока нет — только ожидание сброса в 00:00 по Москве. */
function OutOfAttempts({ resetAt }: { resetAt?: string }) {
  return (
    <div className="tw-out" role="status">
      <p className="ui-label">{t("tower.outOfTries")}</p>
      <p className="ui-sec mt-1">{t("tower.triesInfo")}{" "}{untilReset(resetAt)}.</p>
    </div>
  );
}
