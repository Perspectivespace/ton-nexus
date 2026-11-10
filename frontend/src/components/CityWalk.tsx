import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sendCityAdEvent, useCityAds } from "@/api/hooks";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";
import { pushBack } from "@/lib/backButton";
import { haptic } from "@/lib/haptics";
import { liveSpots } from "./CityAdSpots";
import { getWalkCamera, WalkCamera } from "@/lib/walkCamera";
import { startStreetLife } from "@/lib/walkLife";
import { startTilt } from "@/lib/walkTilt";
import { lowEnd, motionAllowed, reducedMotion, setTiltPref, tiltOffered, tiltPref } from "@/lib/walkPrefs";
import { WebApp } from "@/lib/telegram";
import { districtNav, neighbourOf } from "@/lib/districtNav";
import { lookFor, type DistrictId } from "@/lib/districts";
import { useCityPhase } from "@/lib/cityPhase";
import { AdCard } from "./AdCard";
import { DistrictStrip, EdgeHints, useDistrictsOpen, type EdgeHintsHandle } from "./DistrictNav";

/**
 * «Прогулка» — чистый город (реклама в городе, PR 3; живая камера — PR 5).
 * Вход — пролёт камеры к улице, город можно осматривать пальцем (параллакс слоёв, инерция) и наклоном телефона,
 * на улице время от времени что-то происходит (разовые события). Выход — обратный пролёт. Главная показывает только город на весь экран:
 * панели главной размонтированы, шапка и док скрыты. Выход — кнопка «Выйти» или системная «Назад».
 * Реклама касаема только здесь: касание места → подробная карточка; показы/открытия/переходы считаются только здесь.
 * Анимации — разовые (появление карточки, сдвиг «камеры» через transition); бесконечных нет.
 */

export function CityWalk() {
  const walk = useCityWalk();
  const navigate = useNavigate();
  const { data, refetch } = useCityAds();
  const live = useMemo(() => liveSpots(data?.spots), [data]);
  // районы (PR 3): полоска и протяжка за край — пока только владельцу (до финальных рисунков)
  const districts = useDistrictsOpen();
  const districtsRef = useRef(districts);
  districtsRef.current = districts;
  const hintsRef = useRef<EdgeHintsHandle>(null);
  const goDistrict = (to: DistrictId) => districtNav.go("centre", to, navigate);
  const goRef = useRef(goDistrict);
  goRef.current = goDistrict;
  // соседний район (Неон-ряды) подкачивается в простое — переход краем без экрана «Загрузка»
  const { phase } = useCityPhase();
  useEffect(() => {
    if (!districts) return;
    let stop = () => {};
    let live = true;
    void import("@/lib/districtAssets").then((m) => {
      if (!live) return;
      stop = m.preloadWhenIdle(() => void m.loadDistrict("rows", lookFor(phase).art, lowEnd()).catch(() => undefined));
    });
    return () => {
      live = false;
      stop();
    };
  }, [districts, phase]);

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
    const cam = new WalkCamera(stage, {
      flight: !still,
      inertia: !still,
      onEdge: (dir) => {
        const to = neighbourOf("centre", dir);
        return districtsRef.current && !!to && goRef.current(to);
      },
      onPull: (st) => hintsRef.current?.update(st),
    });
    // пришли из района — камера уже на улице и проезжает от края; иначе — обычный пролёт с вида главной
    cam.enter(districtNav.takeArrival()?.dir);
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
    <div className={`walk-ui${districts ? " has-strip" : ""}`}>
      <div className="walk-top">
        <button
          type="button"
          className="walk-exit"
          onClick={() => {
            haptic.tap();
            cityWalk.leave();
          }}
        >
          <i aria-hidden="true">×</i> Выйти<span className="walk-long"> из прогулки</span>
        </button>
        <div className="walk-tools">
          {/* покупка рекламы (PR 5): уход с главной сам выключает «Прогулку» (Layout) */}
          <button
            type="button"
            className="walk-buy"
            onClick={() => {
              haptic.tap();
              navigate("/ads");
            }}
          >
            <i aria-hidden="true">+</i>
            Реклама
          </button>
          {offered && (
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
          )}
        </div>
      </div>
      {!spot && (
        <p className="walk-hint" role="status">
          {live.length
            ? "Ведите пальцем · коснитесь вывески"
            : data?.spots.some((s) => s.on_sale && !s.ad)
              ? "Ведите пальцем · свободное место можно занять"
              : "Ведите пальцем — осмотритесь"}
        </p>
      )}
      {districts && <EdgeHints ref={hintsRef} current="centre" />}
      {districts && <DistrictStrip current="centre" onGo={goDistrict} />}
      {spot && data && (
        <AdCard
          key={spot.key}
          spot={spot}
          day={data.day}
          onClose={() => cityWalk.close()}
          // камера: вывеска — по центру и над карточкой (с учётом панорамы); после закрытия город возвращается в кадр
          onLayout={(card) => {
            const el = document.querySelector<HTMLElement>(`.cad-spot[data-spot="${spot.key}"]`);
            const cam = getWalkCamera();
            if (el && cam) cam.focus(el, card.offsetHeight);
          }}
          onGone={() => getWalkCamera()?.unfocus()}
        />
      )}
    </div>
  );
}
