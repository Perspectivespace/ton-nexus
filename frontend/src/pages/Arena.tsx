import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, ErrorState, ScreenHeader, Sheet, useToast } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { IconAlert, IconChevron, IconRules } from "@/components/icons";
import { ArenaArt } from "@/components/arena/ArenaArt";
import { ArenaRules } from "@/components/arena/ArenaRules";
import { useMe } from "@/api/hooks";
import { useScreenBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { useArenaJoin, useArenaLobby } from "@/lib/arena/hooks";
import {
  arenaErrorText,
  commissionPct,
  fmtPrize,
  fmtTon,
  money,
  parseArenaError,
  roomName,
  tonOf,
  type ArenaErr,
  type ArenaLobby,
  type ArenaType,
} from "@/lib/arena/api";
import "@/styles/arena.css";
import { t } from "@/i18n";

/** ~длительность матча: на поле 9×9 зона закрывается раньше (как в прототипе) */
const matchLen = (board: number) => (board >= 9 && board < 11 ? "2–3" : "3–4");

function Pips({ n, of }: { n: number; of: number }) {
  return (
    <span className="ar-pips" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? "on" : undefined} />
      ))}
    </span>
  );
}

/** Карточка комнаты: название, игроки и поле, приз за 1 место, 2 место, сколько ждут */
function RoomCard({ rt, sel, onPick }: { rt: ArenaType; sel: boolean; onPick: () => void }) {
  return (
    <button type="button" className={sel ? "ar-room sel" : "ar-room"} aria-pressed={sel} onClick={onPick}>
      <span className="ar-r-head">
        <span className="ar-r-n">{roomName(rt)}</span>
        <span className="ar-r-chk" aria-hidden="true" />
      </span>
      <span className="ar-r-m">
        {rt.seats}{" "}{t("arena.playersDot")}{" "}{rt.board}×{rt.board}
      </span>
      <span className="ar-r-p">
        {fmtPrize(rt.prizes_nano[0] ?? 0)}
        <small>TON</small>
      </span>
      <span className="ar-r-p2">{rt.prizes_nano[1] ? t("arena.place2", { prizesNano: fmtPrize(rt.prizes_nano[1]) }) : t("arena.only1")}</span>
      <span className="ar-r-q">
        {sel && <i className="ar-live" aria-hidden="true" />}
        <Pips n={rt.waiting} of={rt.seats} />
        <span>
          {rt.waiting}/{rt.seats}{" "}{t("arena.waiting")}</span>
      </span>
    </button>
  );
}

/** Деньги выбранной комнаты: ставка, фонд, комиссия, призы, длительность */
function MoneyPanel({ at }: { at: ArenaType }) {
  const m = money(at);
  return (
    <div className="ar-panel ar-money">
      <div className="ar-row">
        <span>{t("arena.stake")}</span>
        <b>{fmtTon(at.stake_nano)} TON</b>
      </div>
      <div className="ar-row">
        <span>
          {t("arena.poolDot")}{" "}{at.seats} × {fmtTon(at.stake_nano)}
        </span>
        <b>{fmtPrize(at.pot_nano)} TON</b>
      </div>
      <div className="ar-row">
        <span>{t("arena.fee")}{" "}{commissionPct(at.commission_bps)}</span>
        <b>−{m.fee.toFixed(2)} TON</b>
      </div>
      <div className="ar-row">
        <span>{t("arena.prizes")}</span>
        <b className="ok">{at.prizes_nano.map((p, i) => t("arena.prizeN", { i: i + 1, p: fmtPrize(p) })).join(" · ")}</b>
      </div>
      <div className="ar-row">
        <span>{t("arena.match")}</span>
        <b>~{matchLen(at.board)}{" "}{t("arena.min")}</b>
      </div>
    </div>
  );
}

/** Не хватает на ставку: сколько и ссылка на пополнение */
export function NeedFunds({ need }: { need: number | null }) {
  return (
    <div className="ar-need" role="alert">
      <IconAlert size={18} />
      <div className="min-w-0 flex-1">
        <b>{need != null && need > 0 ? t("arena.shortBy", { e9: fmtTon(need * 1e9) }) : t("arena.noTon")}</b>
        <p>{t("arena.stakeNote")}</p>
      </div>
      <Link to="/wallet?topup=1" className="ui-btn secondary sm no-underline" onClick={() => haptic.tap()}>
        {t("wallet.topUp")}</Link>
    </div>
  );
}

export interface ArenaLobbyViewProps {
  lobby: ArenaLobby;
  balance: number | null;
  sel: string;
  onPick: (type: string) => void;
  onJoin: () => void;
  onRules: () => void;
  joining: boolean;
  err: ArenaErr | null;
}

/** Лобби (чистый вид, без запросов — для тестов и скриншотов) */
export function ArenaLobbyView({ lobby, balance, sel, onPick, onJoin, onRules, joining, err }: ArenaLobbyViewProps) {
  const at = lobby.types.find((x) => x.type === sel) ?? lobby.types[0];
  const stake = at ? tonOf(at.stake_nano) : 0;
  const short = balance != null && at ? Math.round((stake - balance) * 1e4) / 1e4 : null;
  const need = err?.code === "insufficient_balance" || (short != null && short > 0);
  const active = lobby.active_room_id;
  return (
    <div className="ar-body">
      <div className="ar-hero">
        <ArenaArt id="arh" h={196} className="ar-hero-art" sweep />
        <div className="ar-hero-txt">
          <span className="ui-label ar-neon">{t("arena.kicker")}</span>
          <h2 className="ar-hero-t">{t("games.arena")}</h2>
          <p>{t("arena.heroText")}</p>
          <div className="ar-chips">
            <span>{t("arena.chip10s")}</span>
            <span>{t("arena.chipNoRng")}</span>
            <span>{t("arena.chipSeed")}</span>
          </div>
        </div>
      </div>

      <div className="ar-sec">{t("arena.room")}</div>
      <div className="ar-rooms">
        {lobby.types.map((x) => (
          <RoomCard key={x.type} rt={x} sel={x.type === at?.type} onPick={() => onPick(x.type)} />
        ))}
      </div>

      {at && (
        <>
          <div className="ar-sec">{t("arena.stakePrize")}</div>
          <MoneyPanel at={at} />
        </>
      )}
      <p className="ar-note">
        {t("arena.stakeHeld")}{" "}<b>3:00</b>{" "}{t("arena.stakeHeldTail")}{" "}
        <button type="button" className="ar-link" onClick={onRules}>
          <IconRules size={14} />
          {t("arena.rulesPayouts")}</button>
      </p>

      {active ? (
        <div className="ar-foot">
          <div className="ar-active">{t("arena.alreadyIn")}</div>
          <span className="ui-spill block">
            <Link to={`/arena/${active}`} className="ui-btn primary lg block no-underline" onClick={() => haptic.tap()}>
              {t("arena.backToRoom")}<IconChevron size={16} />
            </Link>
          </span>
        </div>
      ) : (
        <div className="ar-foot">
          {need && <NeedFunds need={short != null && short > 0 ? short : null} />}
          {err && !need && <p className="ar-err" role="alert">{arenaErrorText(err)}</p>}
          <span className="ui-spill block">
            <Button size="lg" block disabled={!at || need || joining} onClick={onJoin}>
              {joining ? t("arena.joining") : (
                <>
                  {t("arena.joinFor")}{" "}<span className="ar-k">{fmtTon(at?.stake_nano ?? 0)} TON</span>
                </>
              )}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * «Арена» — лобби: выбор комнаты (Арена 4 / Арена 8), ставка, призы, комиссия, кто ждёт; вход со ставкой.
 * Данные — GET /arena/rooms (опрос ~1 с). Вход: 402 — «не хватает» + пополнение, 409 already_in_room — в свою комнату.
 */
export default function Arena() {
  useScreenBack("/");
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const lobby = useArenaLobby({ poll: true });
  const join = useArenaJoin();
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<ArenaErr | null>(null);
  const [rules, setRules] = useState(false);
  const bal = me.data ? Number(me.data.balance) : NaN;

  const onJoin = () => {
    const at = lobby.data?.types.find((x) => x.type === sel) ?? lobby.data?.types[0];
    if (!at) return;
    setErr(null);
    join.mutate(at.type, {
      onSuccess: (room) => {
        haptic.collect();
        navigate(`/arena/${room.id}`);
      },
      onError: (e) => {
        const pe = parseArenaError(e);
        if (pe.code === "already_in_room") {
          if (pe.roomId) navigate(`/arena/${pe.roomId}`);
          else void lobby.refetch();
          return;
        }
        if (pe.code === "insufficient_balance") void me.refetch();
        if (pe.code === "arena_disabled") void lobby.refetch();
        setErr(pe);
        if (pe.code !== "insufficient_balance") toast({ kind: "danger", title: t("arena.joinFailed"), sub: arenaErrorText(pe) });
      },
    });
  };

  const lerr = lobby.error ? parseArenaError(lobby.error) : null;
  return (
    <div className="ar space-y-4">
      <BackLink />
      <ScreenHeader eyebrow={t("tower.game")} title={t("games.arena")} action={me.data ? <span className="ar-bal"><i />{Number(me.data.balance).toFixed(4)} TON</span> : undefined} />
      {lobby.data ? (
        <ArenaLobbyView
          lobby={lobby.data}
          balance={Number.isFinite(bal) ? bal : null}
          sel={sel ?? lobby.data.types[0]?.type ?? ""}
          onPick={(at) => {
            haptic.select();
            setSel(at);
            setErr(null);
          }}
          onJoin={onJoin}
          onRules={() => setRules(true)}
          joining={join.isPending}
          err={err}
        />
      ) : lerr?.code === "arena_disabled" ? (
        <ArenaClosed />
      ) : lerr ? (
        <ErrorState title={t("arena.loadFailed")} message={arenaErrorText(lerr)} onRetry={() => void lobby.refetch()} />
      ) : (
        <div className="ar-skel" aria-busy="true" />
      )}
      <Sheet open={rules} onClose={() => setRules(false)} title={t("arena.rulesTitle")} className="ar-sheet">
        <ArenaRules types={lobby.data?.types} />
      </Sheet>
    </div>
  );
}

export function ArenaClosed() {
  return (
    <div className="ar-panel ar-closed">
      <b>{t("arena.closed")}</b>
      <p>{t("arena.closedSub")}</p>
      <Link to="/" className="ui-btn secondary sm no-underline">
        {t("arena.toHome")}</Link>
    </div>
  );
}
