import { Bar, Panel, Reactor } from "@/components/ui";
import { nextTier, type ReactorTier } from "@/lib/reactorTiers";

/** Облик реактора под героем: тизер следующего облика и путь к нему (docs/DESIGN.md, п. 8.1.1). */
export function ReactorTierPanel({ tier, level }: { tier: ReactorTier; level: number }) {
  const next = nextTier(tier);
  const show = next ?? tier;
  return (
    <Panel level="e1" cut="s" className="p-4">
      <div className="flex items-center gap-4">
        <div className="rx-teaser shrink-0" aria-hidden>
          <Reactor fill={0} state="idle" tier={show.id} size={60} plate={false} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="ui-label">{next ? `На ${next.from} ур. · ещё ${next.from - level}` : "Высший облик"}</p>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-6 text-[var(--text)]">
            «{show.name}» · {show.mk}
          </p>
          <p className="ui-sec !text-[12px] !leading-[16px]">{show.look}</p>
        </div>
      </div>
      {next && (
        <Bar
          className="mt-3"
          value={(level - tier.from) / (next.from - tier.from)}
          label={`До облика «${next.name}»: ${level - tier.from} из ${next.from - tier.from} ур.`}
        />
      )}
      <p className="ui-sec mt-2 flex justify-between !text-[12px] !leading-[16px]">
        <span>
          Сейчас: {tier.mk} «{tier.name}»
        </span>
        <span className="font-mono">ур. {level}</span>
      </p>
    </Panel>
  );
}
