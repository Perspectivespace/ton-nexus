import { createRoot } from "react-dom/client";
import { Panel, Reactor, Scrim, Num, Readout, StatTile } from "@/components/ui";
import { ReactorTierPanel } from "@/components/ReactorTierPanel";
import { tierFor } from "@/lib/reactorTiers";

/**
 * Прогрев первого входа в Майнер: один раз в простое главной рисуем невидимую копию тяжёлых блоков экрана
 * (реактор своего облика, панель облика, плитки) — вне экрана и под visibility:hidden, без отрисовки на экран.
 * Так первый разбор и первая раскладка (стили, шрифтовые глифы, JIT) случаются заранее, а не посреди наезда.
 * Побочных эффектов нет: ни запросов, ни кнопки «Назад», ни вибро. Через секунду блок снимается.
 */
export function warmMinerView(level: number): Promise<void> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-9999px;top:0;width:360px;visibility:hidden;pointer-events:none;contain:layout style";
    document.body.appendChild(host);
    const root = createRoot(host);
    const tier = tierFor(level);
    root.render(
      <div className="space-y-4 p-5">
        <Panel level="hero" see cut="l" lift="l2" className="p-5">
          <Reactor fill={0.3} state="idle" tier={tier.id} />
          <Num value="0.000000" unit="TON" size="l" decode={false} />
          <Scrim className="relative -mx-5 -mb-5 mt-5 px-5 pb-5 pt-4">
            <Readout label="Хранилище за цикл" value="0.000000" unit="TON" />
          </Scrim>
        </Panel>
        <ReactorTierPanel tier={tier} level={level} />
        <StatTile label="Мощность" value="1" />
      </div>,
    );
    window.setTimeout(() => {
      root.unmount();
      host.remove();
      resolve();
    }, 1200);
  });
}
