import { useEffect, useRef } from "react";
import { drawSwatch, LEGEND, swatchDpr, type SwatchKind } from "@/lib/arena/swatch";
import { fmtPrize, roomName, money, type ArenaType } from "@/lib/arena/api";

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
  { name: "Арена 4", pot: "0.40", p1: "0.36", p2: "—" },
  { name: "Арена 8", pot: "0.80", p1: "0.50", p2: "0.22" },
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
      <h3>Карта</h3>
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
      <h3>Ход</h3>
      <ul>
        <li>
          Все ходят <b>одновременно</b>, 10 секунд на план. Не успели — стоите на месте.
        </li>
        <li>
          За ход: <b>шаг на 1 клетку + атака</b>, или <b>рывок на 2</b> без атаки, или <b>аптечка</b> (+35 HP).
        </li>
        <li>Лут подбирается сам, когда встаёте на клетку. Лучшее оружие заменяет старое.</li>
        <li>Двое в одну клетку — оба остаются на месте.</li>
      </ul>
      <h3>Бой</h3>
      <table className="ar-wtab">
        <thead>
          <tr>
            <th>Оружие</th>
            <th className="n">Дальность</th>
            <th className="n">Урон</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Кулаки", 1, 12],
            ["Нож", 1, 34],
            ["Пистолет", 3, 20],
            ["Винтовка", 5, 26],
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
          Урон фиксированный, <b>без критов и случайности</b>.
        </li>
        <li>Стены не пропускают выстрелы. Укрытие режет урон издалека вдвое.</li>
        <li>Броня (лёгкая 30, тяжёлая 60) забирает половину каждого удара, пока не кончится.</li>
        <li>
          Атака бьёт по позиции цели <b>после</b> движения: ушла из досягаемости — промах.
        </li>
      </ul>
      <h3>Зона</h3>
      <ul>
        <li>Сжимается на 1 клетку с каждой стороны после ходов 4, 7, 10… до 3×3, затем закрывается.</li>
        <li>Вне зоны: 12 урона за ход, +6 с каждым сужением. После закрытия — урон всем, +8 за каждый ход.</li>
      </ul>
      <h3>Выплаты</h3>
      <table className="ar-wtab">
        <thead>
          <tr>
            <th>Комната</th>
            <th className="n">Фонд</th>
            <th className="n">1 место</th>
            <th className="n">2 место</th>
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
        <li>Комиссия {fee} от фонда. Погибли в один ход — выше тот, у кого было больше HP до хода; поровну — приз делится.</li>
        <li>Карта и старты фиксируются до входа: хэш виден в комнате, seed раскрывается в итогах.</li>
        <li>Не собрались за 3:00 — ставка возвращается на баланс автоматически. Выйти до старта можно с возвратом.</li>
      </ul>
    </div>
  );
}
