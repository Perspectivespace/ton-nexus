import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sendCityAdEvent, type CityAdSpotOnBoard } from "@/api/hooks";
import { adVars } from "@/lib/cityAdPalette";
import { isSafeAdLink, linkHost, openAdLink } from "@/lib/cityAdLink";
import { haptic } from "@/lib/haptics";

/**
 * Карточка объявления в «Прогулке» — Центр и районы (PR 6b): заголовок, подпись, текст, ссылка (https / t.me),
 * переход на внешний сайт — с подтверждением. Открытие и переход считаются (раз в сутки на человека, сервер дедупит).
 * Камеру подводит владелец карточки (onLayout): в Центре — фокус «Прогулки», в районе — проезд улицы.
 */
const FORMAT_RU: Record<string, string> = {
  line: "БЕГУЩАЯ СТРОКА",
  banner: "ГОЛО-БАННЕР",
  neon: "ВЫВЕСКА",
  facade_screen: "ЭКРАН НА ФАСАДЕ",
};

export function daysLeft(until: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${until}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86_400_000) + 1) : 1;
}

export function AdCard({
  spot,
  day,
  onClose,
  onLayout,
  onGone,
}: {
  spot: CityAdSpotOnBoard;
  day: string;
  onClose: () => void;
  /** карточка встала (и после смены её высоты): камера может подвести вывеску */
  onLayout?: (card: HTMLDivElement) => void;
  /** карточка закрыта */
  onGone?: () => void;
}) {
  const ad = spot.ad!;
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  const link = isSafeAdLink(ad.link_url) ? ad.link_url : null;

  useEffect(() => sendCityAdEvent(ad.id, "open", day), [ad.id, day]);

  const layout = useRef(onLayout);
  layout.current = onLayout;
  const gone = useRef(onGone);
  gone.current = onGone;
  useLayoutEffect(() => {
    if (ref.current) layout.current?.(ref.current);
  }, [spot.key, confirm]);
  useEffect(() => () => gone.current?.(), []);

  const go = () => {
    if (!link) return;
    sendCityAdEvent(ad.id, "click", day);
    haptic.tap();
    openAdLink(link, ad.link_kind);
    setConfirm(false);
  };

  return (
    <div ref={ref} className="cad-card" style={adVars(ad.color)} role="dialog" aria-modal="false" aria-labelledby="cad-title">
      <div className="cc-top">
        <span className="cc-kicker">РЕКЛАМА · {FORMAT_RU[spot.format] ?? "ОБЪЯВЛЕНИЕ"}</span>
        <span className="cc-days">ещё {daysLeft(ad.until, day)} дн.</span>
      </div>
      <h3 id="cad-title" className="cc-title">{ad.title}</h3>
      {ad.subtitle && <p className="cc-sub">{ad.subtitle}</p>}
      {ad.body && <p className="cc-body">{ad.body}</p>}
      {link && (
        <div className="cc-link">
          <i className="cc-ico" aria-hidden="true" />
          <span>{linkHost(link)}</span>
          <em>{ad.link_kind === "telegram" ? "Telegram" : "Сайт"}</em>
        </div>
      )}
      {confirm && link ? (
        <div className="cc-confirm" role="alertdialog" aria-label="Переход на сайт">
          <p>
            Откроется внешний сайт <b>{linkHost(link)}</b>. Мы его не проверяем — будьте внимательны с платежами и данными.
          </p>
          <div className="cc-act">
            <button type="button" className="cc-go" onClick={go}>
              Открыть сайт
            </button>
            <button type="button" className="cc-close" onClick={() => setConfirm(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className={`cc-act${link ? "" : " solo"}`}>
          {link && (
            <button
              type="button"
              className="cc-go"
              onClick={() => (ad.link_kind === "telegram" ? go() : setConfirm(true))}
            >
              Перейти
            </button>
          )}
          <button type="button" className="cc-close" onClick={onClose}>
            Закрыть
          </button>
        </div>
      )}
      <p className="cc-note">Объявление прошло модерацию. Реклама в городе — от жителей Nexus.</p>
    </div>
  );
}
