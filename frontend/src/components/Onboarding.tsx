import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, DialGauge, Num, Panel, Reactor, Tag } from "./ui/index";
import { haptic } from "@/lib/haptics";

import { markDone } from "./onboardingFlag";
import { t } from "@/i18n";

type Slide = { title: string; text: string; art: ReactNode };

/** функция, а не константа: тексты берутся на текущем языке (docs/i18n.md) */
const slides = (): Slide[] => [
  {
    title: t("onboarding.s1Title"),
    text: t("onboarding.s1Text"),
    art: <Reactor fill={0.62} state="running" size={188} plate={false} />,
  },
  {
    title: t("onboarding.s2Title"),
    text: t("onboarding.s2Text"),
    art: <DialGauge chance={0.62} className="w-[260px]" />,
  },
  {
    title: t("onboarding.s3Title"),
    text: t("onboarding.s3Text"),
    art: (
      <Panel level="e1" cut="m" className="flex w-[240px] flex-col items-center gap-2 px-5 py-5">
        <Num value="1.2847" unit="TON" size="l" />
        <Tag tone="ok">{t("onboarding.requestCreated")}</Tag>
      </Panel>
    ),
  },
];

/**
 * Знакомство при первом запуске (docs/DESIGN.md, п. 10): три экрана, «Пропустить» на каждом,
 * листаются свайпом или кнопкой. Последняя кнопка «Запустить реактор» ведёт на экран майнера —
 * сам цикл запускает игрок там, отсюда запросов к серверу нет.
 * Иллюстрации неподвижные (кольца реактора здесь не крутятся).
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const startX = useRef<number | null>(null);
  const last = i === slides().length - 1;

  const close = (toMiner: boolean) => {
    markDone();
    onDone();
    if (toMiner) nav("/miner");
  };
  const go = (n: number) => {
    const k = Math.max(0, Math.min(slides().length - 1, n));
    if (k !== i) haptic.select();
    setI(k);
  };

  return (
    <div
      className="onb"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.aria")}
      onPointerDown={(e) => (startX.current = e.clientX)}
      onPointerUp={(e) => {
        if (startX.current == null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 48) go(i + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="onb-top">
        <span className="onb-step">
          {i + 1} / {slides().length}
        </span>
        <Button kind="ghost" size="sm" onClick={() => close(false)}>
          {t("onboarding.skip")}</Button>
      </div>
      <div className="onb-view">
        <div className="onb-track" style={{ transform: `translate3d(${-i * 100}%, 0, 0)` }}>
          {slides().map((s, k) => (
            <section key={k} className="onb-slide" aria-hidden={k !== i}>
              <div className="onb-art">{s.art}</div>
              <h2 className="onb-title">{s.title}</h2>
              <p className="onb-text">{s.text}</p>
            </section>
          ))}
        </div>
      </div>
      <div className="onb-foot">
        <div className="onb-dots" role="tablist">
          {slides().map((_, k) => (
            <button key={k} type="button" role="tab" aria-selected={k === i} aria-label={t("onboarding.screen", { k: k + 1 })} className={k === i ? "on" : ""} onClick={() => go(k)} />
          ))}
        </div>
        <Button kind="primary" size="lg" block onClick={() => (last ? close(true) : go(i + 1))}>
          {last ? t("onboarding.start") : t("onboarding.next")}
        </Button>
      </div>
    </div>
  );
}
