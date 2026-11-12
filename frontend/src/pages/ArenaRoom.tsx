import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, ErrorState, ScreenHeader, useToast } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { IconCheck, IconChevron, IconRefresh } from "@/components/icons";
import { ArenaBattle } from "@/components/arena/ArenaBattle";
import { ArenaResults } from "@/components/arena/ArenaResults";
import { useScreenBack } from "@/lib/backButton";
import { ensureFreshForBattle, setBattleActive } from "@/lib/version";
import { haptic } from "@/lib/haptics";
import {
  useArenaJoin,
  useArenaLeave,
  useArenaLobby,
  useArenaRoom,
  useNow,
} from "@/lib/arena/hooks";
import {
  arenaErrorText,
  fmtPrize,
  fmtTon,
  mmss,
  parseArenaError,
  roomScreen,
  type ArenaRoom as Room,
  type ArenaType,
  type RoomScreen,
} from "@/lib/arena/api";
import "@/styles/arena.css";
import { t } from "@/i18n";

const R0 = 74;
/** сколько ждать проверки версии перед полем (сеть медленная — показываем поле, не держим игрока) */
const FRESH_WAIT_MS = 2500;
const GAP = 0.06;

/** Кольцо радара: по сегменту на место — моё голубое, занятые магента, свободные тусклые */
function Ring({ room }: { room: Room }) {
  const n = room.seats_total;
  const seg = (Math.PI * 2) / n;
  const arcs = room.seats.map((s, i) => {
    const a0 = -Math.PI / 2 + i * seg + GAP;
    const a1 = -Math.PI / 2 + (i + 1) * seg - GAP;
    const p = (a: number) =>
      `${(86 + R0 * Math.cos(a)).toFixed(2)} ${(86 + R0 * Math.sin(a)).toFixed(2)}`;
    const stroke = s?.is_me
      ? "#2BF5FF"
      : s
        ? "#FF2E7E"
        : "rgba(150,170,255,.16)";
    return (
      <path
        key={i}
        d={`M${p(a0)}A${R0} ${R0} 0 0 1 ${p(a1)}`}
        stroke={stroke}
        strokeWidth={5}
        fill="none"
        strokeLinecap="butt"
      />
    );
  });
  return (
    <svg className="ar-ring" viewBox="0 0 172 172" aria-hidden="true">
      <circle
        cx="86"
        cy="86"
        r="64"
        fill="none"
        stroke="rgba(150,170,255,.10)"
      />
      <circle
        cx="86"
        cy="86"
        r="44"
        fill="none"
        stroke="rgba(150,170,255,.08)"
        strokeDasharray="2 4"
      />
      {arcs}
    </svg>
  );
}

const initial = (name: string) =>
  (name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();

function Slots({ room, open }: { room: Room; open: boolean }) {
  const next = open ? room.seats.findIndex((s) => !s) : -1;
  return (
    <div className="ar-slots" data-n={room.seats_total}>
      {room.seats.map((s, i) => (
        <div key={i} className="ar-slot">
          <span
            className={
              s?.is_me
                ? "ar-sock me"
                : s
                  ? "ar-sock full"
                  : i === next
                    ? "ar-sock next"
                    : "ar-sock"
            }
          >
            {s ? initial(s.name) : ""}
          </span>
          <span className="ar-slot-n">
            {s ? (s.is_me ? t("ratings.you") : s.name) : i === next ? t("arena.waitingDots") : t("ratings.free")}
          </span>
        </div>
      ))}
    </div>
  );
}

function Hold({ room, at }: { room: Room; at: ArenaType | undefined }) {
  return (
    <div className="ar-panel ar-hold">
      <div className="ar-row">
        <span>{t("arena.stakeHeldTag")}</span>
        <b>{fmtTon(room.stake_nano)} TON</b>
      </div>
      {(room.prizes_nano ?? at?.prizes_nano) && (
        <div className="ar-row">
          <span>{t("arena.prize")}</span>
          <b className="ok">
            {(room.prizes_nano ?? at?.prizes_nano ?? [])
              .map((p, i) => t("arena.prizeN", { i: i + 1, p: fmtPrize(p) }))
              .join(" · ")}{" "}
            TON
          </b>
        </div>
      )}
      {room.seed_hash && (
        <div className="ar-row">
          <span>{t("arena.mapHash")}</span>
          <b className="ar-mono">
            {room.seed_hash.slice(0, 6)}…{room.seed_hash.slice(-4)}
          </b>
        </div>
      )}
    </div>
  );
}

export interface ArenaRoomViewProps {
  room: Room;
  screen: RoomScreen;
  type?: ArenaType;
  leaving?: boolean;
  again?: boolean;
  onLeave?: () => void;
  onAgain?: () => void;
  /** экран боя: live — показывать (и доиграть финал), out — игрок ушёл к итогам до конца боя */
  battle?: "live" | "out" | "done";
  onBattleDone?: () => void;
  onWatch?: () => void;
  /** идёт проверка версии перед боем (lib/version) — поле ещё не показываем */
  checking?: boolean;
}
const noop = () => {};

/** Экран комнаты по состоянию (чистый вид — для тестов и скриншотов) */
export function ArenaRoomView({
  room,
  screen,
  type,
  leaving,
  again,
  onLeave,
  onAgain,
  battle = "live",
  onBattleDone,
  onWatch,
  checking = false,
}: ArenaRoomViewProps) {
  const name = t("arena.roomName", { seatsTotal: room.seats_total });
  if (screen.kind === "waiting" || screen.kind === "countdown") {
    const cd = screen.kind === "countdown";
    const full = cd || room.taken >= room.seats_total;
    return (
      <div className="ar-body">
        <section className="ar-panel ar-stage">
          <div className="ar-radar" data-cd={cd ? "" : undefined}>
            {!cd && <i className="ar-radar-sweep" aria-hidden="true" />}
            <Ring room={room} />
            <div className="ar-radar-c">
              {cd ? (
                <>
                  <b key={screen.sec} className="ar-cd" aria-live="assertive">
                    {screen.sec}
                  </b>
                  <span>{t("arena.start")}</span>
                </>
              ) : (
                <>
                  <b className="ar-wait-cnt">
                    {room.taken}
                    <small>/{room.seats_total}</small>
                  </b>
                  <span className="ar-wait-tm">
                    {screen.left > 0 ? mmss(screen.left) : "0:00"}
                  </span>
                </>
              )}
            </div>
          </div>
          <p className="ar-wait-t" aria-live="polite">
            {cd
              ? t("arena.roomFull")
              : screen.left > 0
                ? t("arena.waitingPlayers", { taken: room.taken, seatsTotal: room.seats_total })
                : t("arena.timeUp")}
          </p>
          <Slots room={room} open={!full} />
          {cd && (
            <div className="ar-start-in">
              {t("arena.startIn")}{" "}<b>{screen.sec}</b>{" "}{t("arena.fieldDot")}{" "}
              {type ? `${type.board}×${type.board}` : ""}
            </div>
          )}
        </section>
        {!cd && (
          <p className="ar-note">
            {t("arena.fillNote")}</p>
        )}
        <Hold room={room} at={type} />
        {!cd && (
          <div className="ar-foot">
            <Button
              kind="secondary"
              size="lg"
              block
              disabled={full || leaving}
              onClick={onLeave}
            >
              {leaving
                ? t("arena.leaving")
                : t("arena.leaveRefund", { stakeNano: fmtTon(room.stake_nano) })}
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (screen.kind === "battle" || (screen.kind === "finished" && battle === "live")) {
    if (battle === "out" && screen.kind === "battle") {
      const me = room.match?.players?.find((p) => p.is_me);
      const alive = room.match?.players?.filter((p) => p.alive).length ?? 0;
      return (
        <div className="ar-body">
          <div className="ar-panel ar-next">
            <span className="ui-label ar-neon">{t("arena.battleTurn")}{" "}{screen.turn}</span>
            <b>{me && !me.alive ? t("arena.outPlace", { alive: alive + 1 }) : t("arena.notInBattle")}</b>
            <p>{t("arena.resultsCome")}</p>
          </div>
          <div className="ar-foot">
            <Button kind="secondary" size="lg" block onClick={onWatch}>
              {t("arena.watch")}</Button>
            <Link to="/arena" className="ui-btn ghost lg block no-underline">
              {t("arena.toLobby")}</Link>
          </div>
        </div>
      );
    }
    if (checking && screen.kind === "battle")
      return (
        <div className="ar-bt">
          <p className="ar-note">{t("arena.checkingVersion")}</p>
        </div>
      );
    return <ArenaBattle room={room} onDone={onBattleDone ?? noop} />;
  }
  if (screen.kind === "finished") {
    return (
      <div className="ar-body">
        <ArenaResults room={room} name={name} />
        <Again again={again} onAgain={onAgain} />
      </div>
    );
  }
  const txt =
    screen.kind === "refunded"
      ? {
          t: t("arena.notFilled"),
          s: t("arena.notFilledSub", { seatsTotal: room.seats_total, stakeNano: fmtTon(room.stake_nano) }),
        }
      : screen.kind === "cancelled"
        ? {
            t: t("arena.cancelled"),
            s: t("arena.stakeBack", { stakeNano: fmtTon(room.stake_nano) }),
          }
        : {
            t: t("arena.youLeft"),
            s: t("arena.stakeBack", { stakeNano: fmtTon(room.stake_nano) }),
          };
  return (
    <div className="ar-body">
      <div className="ar-panel ar-refund" role="status">
        <span className="ar-refund-i" aria-hidden="true">
          <IconCheck size={22} />
        </span>
        <b>{txt.t}</b>
        <p>{txt.s}</p>
      </div>
      <Again again={again} onAgain={onAgain} />
    </div>
  );
}

function Again({ again, onAgain }: { again?: boolean; onAgain?: () => void }) {
  return (
    <div className="ar-foot ar-foot-2">
      <span className="ui-spill block">
        <Button
          size="lg"
          block
          disabled={again}
          onClick={onAgain}
          icon={<IconRefresh size={18} />}
        >
          {again ? t("arena.joining") : t("arena.again")}
        </Button>
      </span>
      <Link to="/arena" className="ui-btn ghost lg block no-underline">
        {t("arena.toLobby")}{" "}<IconChevron size={16} />
      </Link>
    </div>
  );
}

const TITLE: Record<RoomScreen["kind"], string> = {
  get waiting() { return t("arena.stWaiting"); },
  get countdown() { return t("arena.start"); },
  get battle() { return t("arena.stBattle"); },
  get finished() { return t("arena.stResults"); },
  get refunded() { return t("arena.stRefund"); },
  get cancelled() { return t("arena.stCancel"); },
  get left() { return t("arena.stLeft"); },
};

/**
 * Комната «Арены» (/arena/:id): набор игроков с таймером 3:00, выход с возвратом, автовозврат, отсчёт 3-2-1,
 * дальше — экран боя (ArenaBattle) и итоги. Опрос ~1 с, пока комната живая.
 */
export default function ArenaRoomPage() {
  useScreenBack("/arena");
  const { id } = useParams();
  const rid = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const q = useArenaRoom(rid);
  const lobby = useArenaLobby();
  const leave = useArenaLeave();
  const join = useArenaJoin();
  const room = q.data;
  // таймер нужен только набору и отсчёту; в бою экран меняет опрос
  const now = useNow(
    !!room &&
      (room.status === "waiting" ||
        (room.status === "running" && (room.match?.turn ?? 0) <= 1)),
  );
  const screen = room ? roomScreen(room, now) : null;
  const ltype = lobby.data?.types.find((x) => x.type === room?.type);
  // экран боя: финальный ход доигрывается на поле, к итогам — после «Бой окончен» (или по кнопке)
  const [battle, setBattle] = useState<"live" | "out" | "done">("done");
  const sawBattle = useRef(false);
  const kind = screen?.kind;
  // перед боем — сверить сборку: старый код (свёрнутый Mini App) перезагружается до показа поля, матч ждёт на сервере.
  // Пока проверка идёт, вместо поля — короткий «Проверяем версию…» (не дольше FRESH_WAIT_MS).
  const running = room?.status === "running";
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!running) return;
    setBattleActive(true);
    let off = false;
    const done = () => !off && setFresh(true);
    const timer = window.setTimeout(done, FRESH_WAIT_MS);
    void ensureFreshForBattle().then((reloading) => {
      if (!reloading) done();
    });
    return () => {
      off = true;
      window.clearTimeout(timer);
      setBattleActive(false);
    };
  }, [running]);
  useEffect(() => {
    if (kind === "battle" && !sawBattle.current) {
      sawBattle.current = true;
      setBattle("live");
    }
  }, [kind]);
  const onBattleDone = useCallback(() => setBattle(room?.status === "running" ? "out" : "done"), [room?.status]);
  const onWatch = useCallback(() => setBattle("live"), []);
  const inBattle = !!screen && (screen.kind === "battle" || (screen.kind === "finished" && battle === "live"));

  const onLeave = () =>
    leave.mutate(undefined, {
      onSuccess: (r) => {
        haptic.collect();
        toast({
          kind: "ok",
          title: t("arena.refunded"),
          sub: t("arena.refundedSub", { refundedNano: fmtTon(r.refunded_nano) }),
        });
        navigate("/arena", { replace: true });
      },
      onError: (e) => {
        const pe = parseArenaError(e);
        if (pe.code === "not_joined")
          return void navigate("/arena", { replace: true });
        toast({
          kind: pe.code === "room_state" ? "amber" : "danger",
          title: t("arena.leaveFailed"),
          sub: arenaErrorText(pe),
        });
        void q.refetch();
      },
    });

  const onAgain = () => {
    if (!room) return;
    join.mutate(room.type, {
      onSuccess: (r) => navigate(`/arena/${r.id}`, { replace: true }),
      onError: (e) => {
        const pe = parseArenaError(e);
        if (pe.code === "already_in_room" && pe.roomId)
          return void navigate(`/arena/${pe.roomId}`, { replace: true });
        if (pe.code === "insufficient_balance") {
          toast({
            kind: "danger",
            title: t("upgrade.notEnoughTon"),
            sub: t("arena.topUpWallet"),
          });
          return void navigate("/wallet?topup=1");
        }
        toast({
          kind: "danger",
          title: t("arena.joinFailed"),
          sub: arenaErrorText(pe),
        });
      },
    });
  };

  const err = q.error && !room ? parseArenaError(q.error) : null;
  return (
    <div className="ar space-y-4">
      <BackLink to="/arena" label={t("arena.lobby")} />
      {inBattle ? null : (
        <ScreenHeader
          eyebrow={t("games.arena")}
          title={
            room
              ? t("arena.roomTitle", { seatsTotal: room.seats_total, kind: TITLE[screen!.kind] })
              : t("arena.room")
          }
        />
      )}
      {room && screen ? (
        <ArenaRoomView
          room={room}
          screen={screen}
          type={ltype}
          leaving={leave.isPending}
          again={join.isPending}
          onLeave={onLeave}
          onAgain={onAgain}
          battle={battle}
          onBattleDone={onBattleDone}
          onWatch={onWatch}
          checking={running && !fresh}
        />
      ) : err && (err.status === 404 || err.status === 403) ? (
        <>
          <ErrorState
            title={t("arena.roomGone")}
            message={t("arena.roomGoneSub")}
          />
          <Link to="/arena" className="ui-btn secondary lg block no-underline">
            {t("arena.toLobby")}</Link>
        </>
      ) : err ? (
        <ErrorState
          title={t("arena.roomFailed")}
          message={arenaErrorText(err)}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <div className="ar-skel" aria-busy="true" />
      )}
    </div>
  );
}
