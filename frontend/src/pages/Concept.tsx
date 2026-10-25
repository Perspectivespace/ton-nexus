/**
 * КОНЦЕПТ (ветка concept/miner-tiers, в main не идёт): облик реактора по уровню и идеи города.
 * /concept?t=0..3 — экран майнера с обликом тира; &reveal=1 — раскрытие; /concept?strip=1 — все тиры.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Panel, Reactor, StatTile, Tag, useToast, Num } from "@/components/ui";
import { ScreenHeader } from "@/components/ui";

type T = 0 | 1 | 2 | 3;
export const TIERS: { t: T; lvl: number; name: string; mk: string; look: string }[] = [
  { t: 0, lvl: 1, name: "Прототип", mk: "Mk I", look: "циан, базовый корпус" },
  { t: 1, lvl: 5, name: "Контур", mk: "Mk II", look: "бронепластины, HUD-кольцо, дыхание ядра" },
  { t: 2, lvl: 10, name: "Марк", mk: "Mk III", look: "золото-титан, катушки, ядро добела" },
  { t: 3, lvl: 20, name: "Сингулярность", mk: "Mk IV", look: "призменное ядро, орбиты, маджента" },
];

/** уровень реактора = сумма пяти характеристик − 4 (старт: 1) */
const DEMO_STATS: Record<T, number[]> = { 0: [1, 2, 1, 1, 1], 1: [2, 3, 2, 1, 1], 2: [4, 4, 3, 1, 2], 3: [7, 6, 5, 3, 3] };

export default function Concept() {
  const [q] = useSearchParams();
  const toast = useToast();
  const strip = q.get("strip") === "1";
  const t = Math.max(0, Math.min(3, Number(q.get("t") || 0))) as T;
  const reveal = q.get("reveal") === "1";
  const state = (q.get("state") as "running" | "ready" | "idle") || "running";
  const fill = Number(q.get("fill") || 0.62);
  const city = q.get("city");

  useEffect(() => {
    const el = document.documentElement;
    const cls = (city || "").split(",").filter(Boolean).map((c) => `cc-${c}`);
    if (t >= 2 && city) cls.push(`cc-t${t}`);
    el.classList.add(...cls);
    return () => el.classList.remove(...cls);
  }, [city, t]);

  useEffect(() => {
    if (reveal && t > 0) {
      const id = setTimeout(() => toast({ kind: "ok", title: `Новый облик: «${TIERS[t].name}»`, sub: `Реактор ${TIERS[t].mk} · ${TIERS[t].look}` }), 1500);
      return () => clearTimeout(id);
    }
  }, [reveal, t, toast]);

  if (city) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="Контур" action={<Tag tone="neon">{`город: ${city.toUpperCase()}`}</Tag>} />
      </div>
    );
  }

  if (strip) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="Облик реактора" />
        <div className="grid grid-cols-2 gap-3">
          {TIERS.map((x) => (
            <Panel key={x.t} level="e1" cut="s" className="flex flex-col items-center p-3 pt-5">
              <Reactor fill={fill} state={state} tier={x.t} size={140} plate={false} />
              <p className="mt-4 font-display text-[15px] font-bold uppercase tracking-wide text-[var(--text)]">{x.name}</p>
              <p className="ui-sec !text-[12px]">с {x.lvl} ур. · {x.mk}</p>
            </Panel>
          ))}
        </div>
      </div>
    );
  }

  const stats = DEMO_STATS[t];
  const lvl = stats.reduce((a, b) => a + b, 0) - 4;
  const next = TIERS[t + 1];
  return (
    <div className="space-y-5">
      <ScreenHeader title="Майнер" action={<Tag tone="neon">{TIERS[t].mk}</Tag>} />
      <Panel level="hero" see cut="l" lift="l2" className="p-5">
        <div className="relative flex flex-col items-center pt-2">
          <Reactor fill={fill} state={state} tier={t} reveal={reveal} />
          <p className="ui-label ui-shade mt-6">Реактор «{TIERS[t].name}» · уровень {lvl}</p>
          <Num value="0.004812" unit="TON" size="l" decode={false} glow className="ui-shade mt-1" />
        </div>
      </Panel>
      <div className="grid grid-cols-5 gap-2">
        {(["Мощн.", "Ёмк.", "Длит.", "Удача", "Стаб."] as const).map((k, i) => (
          <StatTile key={k} label={k} value={stats[i]} />
        ))}
      </div>
      {next && (
        <Panel level="e1" cut="s" className="flex items-center gap-4 p-4">
          <div className="rx-teaser shrink-0">
            <Reactor fill={0} state="idle" tier={next.t} size={64} plate={false} />
          </div>
          <div className="min-w-0">
            <p className="ui-label">На {next.lvl} уровне реактора</p>
            <p className="mt-1 text-[15px] font-semibold text-[var(--text)]">Облик «{next.name}» · {next.mk}</p>
            <p className="ui-sec !text-[12px]">{next.look}. Ещё {next.lvl - lvl} ур.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}
