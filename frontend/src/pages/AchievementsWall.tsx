import { useAchWall, type AchRarest, type AchWallEntry } from "@/api/achievements";
import { BackLink } from "@/components/BackLink";
import { useScreenBack } from "@/lib/backButton";
import { AchBadge } from "@/components/achievements/AchBadge";
import { tierTitle } from "@/components/achievements/text";
import { EmptyPanel, ErrorPanel, LoadingPanel, Panel, ScreenHeader } from "@/components/ui";
import { fmtNum, t, tp } from "@/i18n";

const holders = (r: AchRarest) => (r.holders <= 1 ? t("ach.wallOnly") : tp("ach.wallHolders", r.holders));

/** «Стена славы»: игроки с самыми редкими достижениями (топ 50) и место игрока */
export function AchievementsWall() {
  useScreenBack("/achievements");
  const { data, isLoading, error } = useAchWall();
  if (isLoading) return <LoadingPanel label={t("ach.loading")} />;
  if (error || !data) return <ErrorPanel message={t("ach.wallFailed")} />;
  const meInTop = data.entries.some((e) => e.is_me);
  return (
    <div className="space-y-5">
      <ScreenHeader eyebrow={t("ach.title")} title={t("ach.wall")} action={<BackLink to="/achievements" label={t("ach.title")} />} />

      {data.entries.length === 0 ? (
        <EmptyPanel title={t("ach.wallEmpty")} body={t("ach.wallEmptySub")} />
      ) : (
        <Panel className="ach-wall p-0">
          <div className="ach-wall-hd">
            <p className="ui-sec">{t("ach.wallSub")}</p>
            <p className="ui-sec !text-[12px] !leading-[16px]">
              <span className="ui-num">{fmtNum(data.total_players)}</span> {tp("ach.wallPlayers", data.total_players)}
            </p>
          </div>
          <ol className="ach-wall-list">
            {data.entries.map((e) => (
              <WallRow key={e.rank} e={e} />
            ))}
          </ol>
        </Panel>
      )}

      {!meInTop && (
        <Panel className="ach-wall-me p-0" aria-label={t("ach.wallMe")}>
          {data.me ? (
            <div className="ach-wall-row me">
              <span className="ach-wall-rank ui-num">{fmtNum(data.me.rank)}</span>
              {data.me.rarest && <AchBadge metal={data.me.rarest.metal} branch={data.me.rarest.branch} size={40} />}
              <div className="min-w-0 flex-1">
                <p className="ach-wall-name">{t("ach.wallMe")}</p>
                {data.me.rarest && (
                  <p className="ach-wall-sub">
                    {tierTitle(data.me.rarest.branch, data.me.rarest.tier, data.me.rarest.index)} · {holders(data.me.rarest)}
                  </p>
                )}
              </div>
              <span className="ach-wall-cnt ui-num">{tp("ach.wallCount", data.me.count)}</span>
            </div>
          ) : (
            <p className="ui-sec p-4">{t("ach.wallNoMe")}</p>
          )}
        </Panel>
      )}

      <Panel className="p-4">
        <p className="ui-sec !text-[12px] !leading-[16px]">{t("ach.wallHow")}</p>
      </Panel>
    </div>
  );
}

function WallRow({ e }: { e: AchWallEntry }) {
  const r = e.rarest;
  const shown = e.pin ?? r;
  return (
    <li className={`ach-wall-row${e.is_me ? " me" : ""}${e.rank <= 3 ? ` top p${e.rank}` : ""}`}>
      <span className="ach-wall-rank ui-num">{e.rank}</span>
      {shown ? <AchBadge metal={shown.metal} branch={shown.branch} size={e.rank <= 3 ? 48 : 40} /> : <span className="ach-wall-ph" />}
      <div className="min-w-0 flex-1">
        <p className="ach-wall-name">
          <span className="truncate">{e.name ?? t("ach.wallPlayer")}</span>
          <span className="ach-wall-lvl ui-num">
            {t("common.lvlLower")} {e.level}
          </span>
        </p>
        {r && (
          <p className="ach-wall-sub">
            {tierTitle(r.branch, r.tier, r.index)} · <b className={r.holders <= 1 ? "only" : undefined}>{holders(r)}</b>
          </p>
        )}
      </div>
      <span className="ach-wall-cnt ui-num">{tp("ach.wallCount", e.count)}</span>
    </li>
  );
}
