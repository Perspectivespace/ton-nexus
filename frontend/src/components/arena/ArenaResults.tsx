import { useState } from "react";
import { Button } from "@/components/ui";
import { fmtPrize, fmtTon, type ArenaRoom } from "@/lib/arena/api";
import { checkSeed, type SeedCheck } from "@/lib/arena/seed";
import { t, tp } from "@/i18n";

/** нано-TON со знаком: «+0.26», «−0.1», «0» */
export function fmtNet(nano: number): string {
  if (nano === 0) return "0";
  return `${nano > 0 ? "+" : "−"}${fmtTon(Math.abs(nano))}`;
}

/** Три плитки «число + подпись»: мои фраги / урон / ходы на итогах, сводка в истории */
export function ArenaStats({ items }: { items: { v: string; k: string; cls?: string }[] }) {
  return (
    <div className="ar-rs-stats">
      {items.map((x) => (
        <div key={x.k}>
          <b className={x.cls}>{x.v}</b>
          <span>{x.k}</span>
        </div>
      ))}
    </div>
  );
}

/** Итоги боя: моё место и итог (приз − ставка), мои убийства / урон / ходы, таблица, проверка seed */
export function ArenaResults({ room, name }: { room: ArenaRoom; name: string }) {
  const res = [...(room.results ?? [])].sort((a, b) => a.place - b.place || a.seat - b.seat);
  const mine = res.find((r) => r.seat === room.my_seat);
  const turns = room.match?.turn ?? null;
  return (
    <>
      {mine ? <Hero room={room} name={name} mine={mine} turns={turns} /> : (
        <div className="ar-panel ar-end">
          <span className="ui-label ar-neon">{name}{" "}{t("arena.battleOver")}</span>
          <b>{t("arena.results")}</b>
        </div>
      )}
      <div className="ar-panel ar-end">
        <span className="ui-label">{t("arena.r.table")}</span>
        <ol className="ar-res">
          {res.map((r) => (
            <li key={r.seat} className={r.seat === room.my_seat ? "me" : undefined}>
              <span>{r.place}</span>
              <span className="min-w-0 flex-1 truncate">
                {r.seat === room.my_seat ? t("ratings.you") : r.name}
              </span>
              {r.kills != null && <span className="ar-res-k">{tp("arena.r.killsN", r.kills)}</span>}
              <b>{Number(r.prize_nano) > 0 ? `+${fmtPrize(r.prize_nano)}` : "—"}</b>
            </li>
          ))}
        </ol>
      </div>
      <SeedPanel room={room} />
    </>
  );
}

function Hero({
  room,
  name,
  mine,
  turns,
}: {
  room: ArenaRoom;
  name: string;
  mine: ArenaRoom["results"][number];
  turns: number | null;
}) {
  const prize = Number(mine.prize_nano) || 0;
  const net = prize - (Number(room.stake_nano) || 0);
  const tag = mine.place === 1 ? t("arena.r.win") : prize > 0 ? t("arena.r.inPrizes") : t("arena.r.noPrize");
  const alive = mine.death_turn == null ? turns : mine.death_turn;
  return (
    <div className={`ar-panel ar-rs${mine.place === 1 ? " win" : ""}`}>
      <span className="ui-label ar-neon">{name}{" "}{t("arena.battleOver")}</span>
      <div className="ar-rs-top">
        <div className="ar-rs-place">
          <b>{mine.place}</b>
          <span>{t("arena.r.ofN", { n: room.seats_total })}</span>
        </div>
        <div className="ar-rs-net">
          <span className="ar-rs-tag">{tag}</span>
          <b className={net > 0 ? "ok" : net < 0 ? "bad" : undefined}>{fmtNet(net)}{" "}TON</b>
          <span>
            {prize > 0
              ? t("arena.r.prizeStake", { prize: fmtPrize(prize), stake: fmtTon(room.stake_nano) })
              : t("arena.r.stakeOnly", { stake: fmtTon(room.stake_nano) })}
          </span>
        </div>
      </div>
      {mine.kills != null && (
        <ArenaStats
          items={[
            { v: String(mine.kills), k: t("arena.r.kills") },
            { v: String(mine.dealt ?? 0), k: t("arena.r.dealt") },
            { v: alive != null ? String(alive) : "—", k: mine.death_turn == null ? t("arena.r.toEnd") : t("arena.r.turnsAlive") },
          ]}
        />
      )}
    </div>
  );
}

/** Честная карта: хэш был до боя; seed и соль раскрыты — браузер сам считает sha256 */
function SeedPanel({ room }: { room: ArenaRoom }) {
  const [st, setSt] = useState<SeedCheck | "busy" | null>(null);
  if (room.seed == null || !room.seed_salt || !room.seed_hash) return null;
  const { seed, seed_salt: salt, seed_hash: hash } = room;
  const run = async () => {
    setSt("busy");
    try {
      setSt(await checkSeed(seed, salt, hash));
    } catch {
      setSt("na");
    }
  };
  return (
    <div className="ar-panel ar-seed">
      <span className="ui-label">{t("arena.r.fair")}</span>
      <p>{t("arena.r.fairText")}</p>
      <dl>
        <dt>{t("arena.mapHash")}</dt>
        <dd className="ar-mono">{hash}</dd>
        <dt>{t("arena.r.seed")}</dt>
        <dd className="ar-mono">{seed}</dd>
        <dt>{t("arena.r.salt")}</dt>
        <dd className="ar-mono">{salt}</dd>
      </dl>
      {st === "ok" || st === "bad" || st === "na" ? (
        <p className={`ar-seed-r ${st}`} role="status">
          {st === "ok" ? t("arena.r.seedOk") : st === "bad" ? t("arena.r.seedBad") : t("arena.r.seedNa")}
        </p>
      ) : (
        <Button kind="secondary" size="md" block disabled={st === "busy"} onClick={run}>
          {st === "busy" ? t("arena.r.checking") : t("arena.r.check")}
        </Button>
      )}
    </div>
  );
}
