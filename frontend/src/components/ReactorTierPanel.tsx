import { Bar, Panel, Reactor } from "@/components/ui";
import { nextTier, type ReactorTier } from "@/lib/reactorTiers";
import { quote, t } from "@/i18n";

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
          <p className="ui-label">{next ? t("reactor.nextAt", { from: next.from, level: next.from - level }) : t("reactor.topLook")}</p>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-6 text-[var(--text)]">
            {quote(show.name)} · {show.mk}
          </p>
          <p className="ui-sec !text-[12px] !leading-[16px]">{show.look}</p>
        </div>
      </div>
      {next && (
        <Bar
          className="mt-3"
          value={(level - tier.from) / (next.from - tier.from)}
          label={t("reactor.toLook", { name: next.name, from: level - tier.from, from2: next.from - tier.from })}
        />
      )}
      <p className="ui-sec mt-2 flex justify-between !text-[12px] !leading-[16px]">
        <span>
          {t("reactor.now")}{" "}{tier.mk} {quote(tier.name)}
        </span>
        <span className="font-mono">{t("reactor.lvl")}{" "}{level}</span>
      </p>
    </Panel>
  );
}
