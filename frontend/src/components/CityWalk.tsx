import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sendCityAdEvent, useCityAds, type CityAdSpotOnBoard } from "@/api/hooks";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";
import { adVars } from "@/lib/cityAdPalette";
import { isSafeAdLink, linkHost, openAdLink } from "@/lib/cityAdLink";
import { pushBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { liveSpots } from "./CityAdSpots";
import { getWalkCamera, WalkCamera } from "@/lib/walkCamera";
import { startStreetLife } from "@/lib/walkLife";
import { startTilt } from "@/lib/walkTilt";
import { motionAllowed, reducedMotion, setTiltPref, tiltOffered, tiltPref } from "@/lib/walkPrefs";
import { WebApp } from "@/lib/telegram";

/**
 * «Прогулка» — чистый город (реклама в городе, PR 3; живая камера — PR 5).
 * Вход — пролёт камеры к улице, город можно осматривать пальцем (параллакс слоёв, инерция) и наклоном телефона,
 * на улице время от времени что-то происходит (разовые события). Выход — обратный пролёт. Главная показывает только город на весь экран:
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
        else cityWalk.leave();
      }),
    [],
  );

  // камера: пролёт на входе (до первой отрисовки — без вспышки), обратный пролёт на выходе
  useLayoutEffect(() => {
    const stage = document.querySelector<HTMLElement>(".city .c-stage");
    if (!stage) return;
    const still = reducedMotion();
    const cam = new WalkCamera(stage, { flight: !still, inertia: !still });
    cam.enter();
    cityWalk.setLeaveHook((done) => cam.leave(done));
    // вертикальный свайп в Telegram сворачивает приложение — на время «Прогулки» он выключен
    let swipes = false;
    try {
      if (WebApp?.platform !== "unknown" && WebApp.isVersionAtLeast("7.7") && WebApp.isVerticalSwipesEnabled) {
        swipes = true;
        WebApp.disableVerticalSwipes();
      }
    } catch {
      /* вне Telegram */
    }
    return () => {
      cityWalk.setLeaveHook(null);
      cam.destroy();
      try {
        if (swipes) WebApp.enableVerticalSwipes();
      } catch {
        /* вне Telegram */
      }
    };
  }, []);

  // жизнь улицы — разовые события, не на слабых устройствах и не при «меньше движения»
  useEffect(() => {
    const stage = document.querySelector<HTMLElement>(".city .c-stage");
    if (!stage || !motionAllowed()) return;
    const life = startStreetLife(stage);
    if (import.meta.env.DEV) (window as unknown as { __walkSpawn?: unknown }).__walkSpawn = life.spawn;
    return life.stop;
  }, []);

  // наклон телефона — лёгкий параллакс, с переключателем
  const offered = useMemo(() => tiltOffered(), []);
  const [tilt, setTilt] = useState(() => offered && tiltPref());
  useEffect(() => {
    if (!tilt) return;
    const stop = startTilt((v) => getWalkCamera()?.setTilt(v));
    return () => {
      stop();
      getWalkCamera()?.setTilt({ x: 0, y: 0 });
    };
  }, [tilt]);

  const spot = live.find((s) => s.key === walk.picked) ?? null;

  return (
    <div className="walk-ui">
      <div className="walk-top">
        <button
          type="button"
          className="walk-exit"
          onClick={() => {
            haptic.tap();
            cityWalk.leave();
          }}
        >
          <i aria-hidden="true">×</i> Выйти из прогулки
        </button>
        {offered && (
          <div className="walk-tools">
            <button
              type="button"
              className={`walk-tilt${tilt ? " on" : ""}`}
              aria-pressed={tilt}
              onClick={() => {
                haptic.tap();
                setTiltPref(!tilt);
                setTilt(!tilt);
              }}
            >
              <i aria-hidden="true" />
              Наклон
            </button>
          </div>
        )}
      </div>
      {!spot && (
        <p className="walk-hint" role="status">
          {live.length ? "Ведите пальцем · коснитесь вывески" : "Ведите пальцем — осмотритесь"}
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

  // камера: вывеска — по центру и над карточкой (с учётом панорамы); после закрытия город возвращается в кадр
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`.cad-spot[data-spot="${spot.key}"]`);
    const card = ref.current;
    const cam = getWalkCamera();
    if (!el || !card || !cam) return;
    cam.focus(el, card.offsetHeight);
  }, [spot.key, confirm]);
  useEffect(() => () => getWalkCamera()?.unfocus(), []);

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
