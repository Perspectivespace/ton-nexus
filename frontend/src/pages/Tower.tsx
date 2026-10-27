import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, ScreenHeader, Button, Num, StatusPill } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { isFpsOn } from "@/lib/fps";
import * as engine from "@/lib/tower/engine";
import { TowerRun } from "@/lib/tower/runtime";
import { FREE_ATTEMPTS, loadBest, randomSeed, saveBest } from "@/lib/tower/store";
import "@/styles/tower.css";

type Phase = "idle" | "play" | "over";

interface Summary {
  score: number;
  height: number;
  perfects: number;
  bestCombo: number;
  record: boolean;
}

/**
 * «Башня» (PR 1: игра на клиенте). Блок скользит над башней, тап роняет его, свес отрезается;
 * идеальный бросок — бонус и серия. Игровая логика — lib/tower/engine.ts (чистая, по seed и журналу тапов),
 * отрисовка — lib/tower/runtime.ts (один canvas, один rAF, стоит в простое и при свёрнутом приложении).
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
  const [best, setBest] = useState(loadBest);
  const [sum, setSum] = useState<Summary | null>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

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
        const record = saveBest(g.score);
        setBest((b) => Math.max(b, g.score));
        setSum({ score: g.score, height: g.blocks.length - 1, perfects: g.perfects, bestCombo: g.bestCombo, record });
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

  const play = useCallback(() => {
    setScore(0);
    setCombo(0);
    setDropped(0);
    setSum(null);
    setPhase("play");
    run.current?.start(randomSeed());
  }, [setPhase]);

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

  return (
    <div className="space-y-4">
      <BackLink />
      <ScreenHeader eyebrow="Игра" title="Башня" action={best > 0 ? <StatusPill tone="neutral">рекорд {best}</StatusPill> : undefined} />

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
          <canvas ref={canvas} aria-label="Поле игры «Башня»" role="img" />

          {phase !== "idle" && (
            <div className="tw-plate" aria-live="off">
              <Num value={score} size="l" decode={false} className="!text-[28px] !leading-[32px]" />
              {combo >= 2 && <span className="tw-combo">×{combo} идеально</span>}
            </div>
          )}

          {phase === "play" && dropped === 0 && <div className="tw-hint">тап — бросить блок</div>}

          {phase === "idle" && (
            <div className="tw-sheet space-y-3">
              <div>
                <p className="ui-label">Башня</p>
                <p className="ui-sec mt-1">Блок скользит над башней — тапните, когда он ровно над ней. Свес отрежется, идеальный бросок даёт бонус и серию.</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="ui-sys">рекорд: {best}</span>
                <span className="ui-sys">попытки: {FREE_ATTEMPTS}/{FREE_ATTEMPTS}</span>
              </div>
              <div className="ui-spill">
                <Button kind="primary" size="lg" block onClick={play}>
                  Играть
                </Button>
              </div>
            </div>
          )}

          {phase === "over" && sum && (
            <div className="tw-sheet space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="ui-label">{sum.record ? "Новый рекорд" : "Игра окончена"}</p>
                  <Num value={sum.score} size="xl" decode={false} tone={sum.record ? "amber" : undefined} className="mt-1 block !text-[40px] !leading-[44px]" />
                </div>
                <div className="space-y-0.5 text-right">
                  <p className="ui-sys">рекорд: {best}</p>
                  <p className="ui-sys">блоков: {sum.height}</p>
                  <p className="ui-sys">идеально: {sum.perfects} · серия {sum.bestCombo}</p>
                </div>
              </div>
              <div className="ui-spill">
                <Button kind="primary" size="lg" block onClick={play}>
                  Ещё раз
                </Button>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
