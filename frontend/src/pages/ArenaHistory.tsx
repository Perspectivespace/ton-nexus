import { Link } from "react-router-dom";
import { Button, ErrorState, ScreenHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { IconChevron } from "@/components/icons";
import { ArenaStats, fmtNet } from "@/components/arena/ArenaResults";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { useArenaHistory } from "@/lib/arena/hooks";
import { arenaErrorText, parseArenaError, roomName, type ArenaHistory, type ArenaHistoryItem } from "@/lib/arena/api";
import "@/styles/arena.css";
import { fmtDate, t, tp } from "@/i18n";

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function Row({ it }: { it: ArenaHistoryItem }) {
  const net = Number(it.net_nano) || 0;
  const stopped = it.status === "cancelled";
  const sub = stopped
    ? t("arena.h.stopped")
    : [tp("arena.r.killsN", it.kills), it.turns != null ? tp("arena.h.turnsN", it.turns) : null].filter(Boolean).join(" · ");
  return (
    <li>
      <Link to={`/arena/${it.room_id}`} className={`ar-h-row${it.place === 1 ? " win" : ""}`} onClick={() => haptic.tap()}>
        <span className="ar-h-place">{stopped || it.place == null ? "—" : `#${it.place}`}</span>
        <span className="ar-h-mid">
          <b>
            {roomName(it)}
            {it.finished_at && <span>{fmtDate(it.finished_at, WHEN)}</span>}
          </b>
          <span>{sub}</span>
        </span>
        <b className={`ar-h-net${net > 0 ? " ok" : net < 0 ? " bad" : ""}`}>{fmtNet(net)}</b>
        <IconChevron size={14} />
      </Link>
    </li>
  );
}

export interface ArenaHistoryViewProps {
  pages: ArenaHistory[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}

/** История боёв (чистый вид — для тестов и скриншотов): сводка, список, «Показать ещё» */
export function ArenaHistoryView({ pages, hasMore, loadingMore, onMore }: ArenaHistoryViewProps) {
  const sum = pages[0]?.summary;
  const items = pages.flatMap((p) => p.items);
  if (!items.length)
    return (
      <div className="ar-body">
        <div className="ar-panel ar-closed">
          <b>{t("arena.h.empty")}</b>
          <p>{t("arena.h.emptySub")}</p>
          <Link to="/arena" className="ui-btn secondary sm no-underline">
            {t("arena.toLobby")}</Link>
        </div>
      </div>
    );
  const net = Number(sum?.net_nano ?? 0);
  return (
    <div className="ar-body">
      {sum && (
        <ArenaStats
          items={[
            { v: String(sum.played), k: t("arena.h.played") },
            { v: String(sum.wins), k: t("arena.h.wins") },
            { v: fmtNet(net), k: t("arena.h.net"), cls: net > 0 ? "ok" : net < 0 ? "bad" : undefined },
          ]}
        />
      )}
      <ul className="ar-h">
        {items.map((it) => (
          <Row key={it.room_id} it={it} />
        ))}
      </ul>
      {hasMore && (
        <Button kind="ghost" size="md" block disabled={loadingMore} onClick={onMore}>
          {loadingMore ? t("arena.h.loading") : t("arena.h.more")}
        </Button>
      )}
    </div>
  );
}

/** «Арена» — мои бои: место, итог в TON, фраги, ходы; тап — итоги боя. GET /arena/history */
export default function ArenaHistoryPage() {
  useScreenBack("/arena");
  const q = useArenaHistory();
  const err = q.error ? parseArenaError(q.error) : null;
  return (
    <div className="ar space-y-4">
      <BackLink to="/arena" label={t("arena.lobby")} />
      <ScreenHeader eyebrow={t("games.arena")} title={t("arena.h.title")} />
      {q.data ? (
        <ArenaHistoryView
          pages={q.data.pages}
          hasMore={!!q.hasNextPage}
          loadingMore={q.isFetchingNextPage}
          onMore={() => void q.fetchNextPage()}
        />
      ) : err ? (
        <ErrorState title={t("arena.h.loadFailed")} message={arenaErrorText(err)} onRetry={() => void q.refetch()} />
      ) : (
        <div className="ar-skel" aria-busy="true" />
      )}
    </div>
  );
}
