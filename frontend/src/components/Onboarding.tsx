import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, DialGauge, Num, Panel, Reactor, Tag } from "./ui/index";
import { haptic } from "@/lib/haptics";

import { markDone } from "./onboardingFlag";

type Slide = { title: string; text: string; art: ReactNode };

const SLIDES: Slide[] = [
  {
    title: "Реактор работает, пока вы спите",
    text: "Запустите цикл — реактор сам копит TON в хранилище. Заходите собрать, когда удобно.",
    art: <Reactor fill={0.62} state="running" size={188} plate={false} />,
  },
  {
    title: "Усиливайте параметры",
    text: "Колесо выбирает параметр, циферблат показывает шанс. Провал сжигает ставку — Фокус и Запрет помогают.",
    art: <DialGauge chance={0.62} className="w-[260px]" />,
  },
  {
    title: "Выводите в TON",
    text: "Баланс растёт от майнинга и заданий. Вывод — на ваш TON-кошелёк, заявку проверяет оператор.",
    art: (
      <Panel level="e1" cut="m" className="flex w-[240px] flex-col items-center gap-2 px-5 py-5">
        <Num value="1.2847" unit="TON" size="l" />
        <Tag tone="ok">Заявка создана</Tag>
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
  const last = i === SLIDES.length - 1;

  const close = (toMiner: boolean) => {
    markDone();
    onDone();
    if (toMiner) nav("/miner");
  };
  const go = (n: number) => {
    const k = Math.max(0, Math.min(SLIDES.length - 1, n));
    if (k !== i) haptic.select();
    setI(k);
  };

  return (
    <div
      className="onb"
      role="dialog"
      aria-modal="true"
      aria-label="Знакомство с TON Nexus"
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
          {i + 1} / {SLIDES.length}
        </span>
        <Button kind="ghost" size="sm" onClick={() => close(false)}>
          Пропустить
        </Button>
      </div>
      <div className="onb-view">
        <div className="onb-track" style={{ transform: `translate3d(${-i * 100}%, 0, 0)` }}>
          {SLIDES.map((s, k) => (
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
          {SLIDES.map((_, k) => (
            <button key={k} type="button" role="tab" aria-selected={k === i} aria-label={`Экран ${k + 1}`} className={k === i ? "on" : ""} onClick={() => go(k)} />
          ))}
        </div>
        <Button kind="primary" size="lg" block onClick={() => (last ? close(true) : go(i + 1))}>
          {last ? "Запустить реактор" : "Далее"}
        </Button>
      </div>
    </div>
  );
}
