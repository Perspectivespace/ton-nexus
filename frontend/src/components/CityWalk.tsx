import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sendCityAdEvent, useCityAds, type CityAdSpotOnBoard } from "@/api/hooks";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";
import { adVars } from "@/lib/cityAdPalette";
import { isSafeAdLink, linkHost, openAdLink } from "@/lib/cityAdLink";
import { pushBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { liveSpots } from "./CityAdSpots";

/**
 * «Прогулка» — чистый город (реклама в городе, PR 3). Главная показывает только город на весь экран:
 * панели главной размонтированы, шапка и док скрыты. Выход — кнопка «Выйти» или системная «Назад».
 * Реклама касаема только здесь: касание места → подробная карточка; показы/открытия/переходы считаются только здесь.
 * Анимации — разовые (появление карточки, сдвиг «камеры» через transition); бесконечных нет.
 */
const FORMAT_RU: Record<string, string> = { line: "БЕГУЩАЯ СТРОКА", banner: "ГОЛО-БАННЕР", neon: "ВЫВЕСКА" };

function daysLeft(until: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${until}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86_400_000) + 1) : 1;
}

export function CityWalk() {
  const walk = useCityWalk();
  const { data, refetch } = useCityAds();
  const live = useMemo(() => liveSpots(data?.spots), [data]);

  // вход: свежая витрина (выход при уходе с главной — в Layout)
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // показы — только в «Прогулке», раз в сутки на объявление (сервер дедупит, клиент не повторяет)
  useEffect(() => {
    if (!data) return;
    for (const s of live) sendCityAdEvent(s.ad!.id, "impression", data.day);
  }, [data, live]);

  // системная «Назад»: закрыть карточку, иначе выйти из «Прогулки»
  useEffect(
    () =>
      pushBack(() => {
        if (cityWalk.get().picked) cityWalk.close();
        else cityWalk.exit();
      }),
    [],
  );

  const spot = live.find((s) => s.key === walk.picked) ?? null;

  return (
    <div className="walk-ui">
      <div className="walk-top">
        <button
          type="button"
          className="walk-exit"
          onClick={() => {
            haptic.tap();
            cityWalk.exit();
          }}
        >
          <i aria-hidden="true">×</i> Выйти из прогулки
        </button>
      </div>
      {!spot && (
        <p className="walk-hint" role="status">
          {live.length ? "Коснитесь вывески, чтобы открыть объявление" : "Сегодня в городе тихо — рекламы нет"}
        </p>
      )}
      {spot && data && <AdCard key={spot.key} spot={spot} day={data.day} />}
    </div>
  );
}

function AdCard({ spot, day }: { spot: CityAdSpotOnBoard; day: string }) {
  const ad = spot.ad!;
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  const link = isSafeAdLink(ad.link_url) ? ad.link_url : null;

  useEffect(() => sendCityAdEvent(ad.id, "open", day), [ad.id, day]);

  // «камера»: город сдвигается вверх, чтобы выбранное место осталось видно над карточкой (один transition)
  useLayoutEffect(() => {
    const stage = document.querySelector<HTMLElement>(".city .c-stage");
    const el = document.querySelector<HTMLElement>(`.cad-spot[data-spot="${spot.key}"]`);
    const card = ref.current;
    if (!stage || !el || !card) return;
    const shift = Number.parseFloat(stage.style.getPropertyValue("--cam")) || 0;
    const bottom = el.getBoundingClientRect().bottom - shift;
    const gap = bottom + 24 - (window.innerHeight - 12 - card.offsetHeight);
    stage.style.setProperty("--cam", `${-Math.max(0, Math.round(gap))}px`);
    return () => {
      stage.style.removeProperty("--cam");
    };
  }, [spot.key]);

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
          <button type="button" className="cc-close" onClick={() => cityWalk.close()}>
            Закрыть
          </button>
        </div>
      )}
      <p className="cc-note">Объявление прошло модерацию. Реклама в городе — от жителей Nexus.</p>
    </div>
  );
}
