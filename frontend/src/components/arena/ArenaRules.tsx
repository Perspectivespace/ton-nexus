import { useEffect, useRef } from "react";
import { drawSwatch, LEGEND, swatchDpr, type SwatchKind } from "@/lib/arena/swatch";
import { fmtPrize, roomName, money, type ArenaType } from "@/lib/arena/api";
import { t } from "@/i18n";

/** Образец клетки: canvas рисуется после монтирования (в SSR/тестах — пустая рамка) */
function Swatch({ k }: { k: SwatchKind }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (cv.current) drawSwatch(cv.current, k, swatchDpr());
  }, [k]);
  return <canvas ref={cv} width={30} height={39} data-k={k} />;
}

/** Выплаты по умолчанию — как в RULES.md (пока лобби не загрузилось) */
const DEFAULT_PAYOUTS = [
  { get name() { return t("arena.name4"); }, pot: "0.40", p1: "0.36", p2: "—" },
  { get name() { return t("arena.name8"); }, pot: "0.80", p1: "0.50", p2: "0.22" },
];

/**
 * Правила «Арены»: легенда «Карта» (образцы клеток тем же рендером, что и поле), ход, бой, зона, выплаты.
 * Содержимое шторки; таблица выплат — из лобби (GET /arena/rooms), иначе значения по умолчанию.
 */
export function ArenaRules({ types }: { types?: ArenaType[] }) {
  const pay = types?.length
    ? types.map((t) => ({ name: roomName(t), pot: money(t).pot.toFixed(2), p1: fmtPrize(t.prizes_nano[0] ?? 0), p2: t.prizes_nano[1] ? fmtPrize(t.prizes_nano[1]) : "—" }))
    : DEFAULT_PAYOUTS;
  const fee = types?.[0] ? `${types[0].commission_bps / 100}%` : "10%";
  return (
    <div className="ar-rules">
      <h3>{t("arena.map")}</h3>
      <div className="ar-legend">
        {LEGEND.map((l) => (
          <div className="ar-lg" key={l.k}>
            <i>
              <Swatch k={l.k} />
            </i>
            <span>
              <b>{l.title}</b>
              {l.text}
            </span>
          </div>
        ))}
      </div>
      <h3>{t("arena.turn")}</h3>
      <ul>
        <li>
          {t("arena.rEveryone")}{" "}<b>{t("arena.rAtOnce")}</b>{t("arena.rPlanTime")}</li>
        <li>
          {t("arena.rPerTurn")}{" "}<b>{t("arena.rStepAttack")}</b>{t("arena.rOr")}{" "}<b>{t("arena.rDash")}</b>{" "}{t("arena.rNoAttackOr")}{" "}<b>{t("arena.rMedkit")}</b> (+35 HP).
        </li>
        <li>{t("arena.rLoot")}</li>
        <li>{t("arena.rCollide")}</li>
      </ul>
      <h3>{t("arena.rBattle")}</h3>
      <table className="ar-wtab">
        <thead>
          <tr>
            <th>{t("arena.rWeapon")}</th>
            <th className="n">{t("arena.rRange")}</th>
            <th className="n">{t("arena.rDamage")}</th>
          </tr>
        </thead>
        <tbody>
          {[
            [t("arena.w.fists"), 1, 12],
            [t("arena.w.knife"), 1, 34],
            [t("arena.w.pistol"), 3, 20],
            [t("arena.w.rifle"), 5, 26],
          ].map(([n, r, d]) => (
            <tr key={n}>
              <td>{n}</td>
              <td className="n">{r}</td>
              <td className="n">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="ar-after">
        <li>
          {t("arena.rFixed")}{" "}<b>{t("arena.rNoCrit")}</b>.
        </li>
        <li>{t("arena.rWalls")}</li>
        <li>{t("arena.rArmor")}</li>
        <li>
          {t("arena.rHitsPos")}{" "}<b>{t("arena.rAfter")}</b>{" "}{t("arena.rMoveMiss")}</li>
      </ul>
      <h3>{t("arena.zone")}</h3>
      <ul>
        <li>{t("arena.rZone")}</li>
        <li>{t("arena.rOutside")}</li>
      </ul>
      <h3>{t("arena.rPayouts")}</h3>
      <table className="ar-wtab">
        <thead>
          <tr>
            <th>{t("arena.room")}</th>
            <th className="n">{t("arena.pool")}</th>
            <th className="n">{t("arena.place1")}</th>
            <th className="n">{t("arena.place2nd")}</th>
          </tr>
        </thead>
        <tbody>
          {pay.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td className="n">{p.pot}</td>
              <td className="n">{p.p1}</td>
              <td className="n">{p.p2}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="ar-after">
        <li>{t("arena.fee")}{" "}{fee}{" "}{t("arena.rFeeTail")}</li>
        <li>{t("arena.rFair")}</li>
        <li>{t("arena.rRefund")}</li>
      </ul>
    </div>
  );
}
