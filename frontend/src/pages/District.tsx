import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "@/api/hooks";
import { pushBack } from "@/lib/backButton";
import { useCityPhase } from "@/lib/cityPhase";
import { DistrictCamera, type CamLayer } from "@/lib/districtCamera";
import { ARRIVE_MS, districtNav, neighbourOf } from "@/lib/districtNav";
import { DistrictStrip, EdgeHints, type EdgeHintsHandle } from "@/components/DistrictNav";
import { loadDistrict, preloadWhenIdle, type LayerUrls } from "@/lib/districtAssets";
import { startDistrictLife } from "@/lib/districtLife";
import {
  DISTRICT_RU, isSceneDistrict, LANES, LAYERS, layerBoxWidth, lookFor, neighbours, panRange, streetWidth, type SceneDistrict,
} from "@/lib/districts";
import { haptic } from "@/lib/haptics";
import { WebApp } from "@/lib/telegram";
import { lowEnd, motionAllowed, reducedMotion } from "@/lib/walkPrefs";
import "@/styles/districts.css";

/**
 * Экран района (PR 2 районов — движок сцены). Пока скрыт от игроков: открывается только в dev-сборке
 * или владельцу — по адресу /district?d=rows|port (или прямой ссылкой с start_param «district-rows» / «district-port»).
 * PR 3: полоска «Центр · Неон-ряды · Порт», протяжка за край улицы — к соседу, «Назад» — в Центр («Прогулка»),
 * «Выйти» — на главную. Рисунки — черновые (эскизы шага 0).
 *
 * ?lite=1 — показать вариант слабого устройства; ?phase=dawn|day|dusk|night — фаза суток (как у города).
 */
export function District() {
  const me = useMe();
  const [sp] = useSearchParams();
  const allowed = import.meta.env.DEV || me.data?.is_owner === true;
  if (!allowed) return me.isLoading ? null : <Navigate to="/" replace />;
  const q = sp.get("d");
  const d: SceneDistrict = isSceneDistrict(q) ? q : "rows";
  return <DistrictScene key={d} district={d} forceLite={sp.get("lite") === "1"} />;
}

function useViewport() {
  const [vp, setVp] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

export function DistrictScene({ district, forceLite = false }: { district: SceneDistrict; forceLite?: boolean }) {
  const navigate = useNavigate();
  const { phase } = useCityPhase();
  const look = lookFor(phase);
  const lite = useMemo(() => forceLite || lowEnd(), [forceLite]);
  const { vw, vh } = useViewport();
  const [urls, setUrls] = useState<LayerUrls | null>(null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<DistrictCamera | null>(null);
  const hintsRef = useRef<EdgeHintsHandle>(null);
  const lastX = useRef<number | null>(null);

  const exit = () => navigate("/");
  const go = (to: Parameters<typeof districtNav.go>[1]) => districtNav.go(district, to, navigate);

  // слои текущего района — по требованию; смена фазы подменяет рисунок, когда новый уже декодирован
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadDistrict(district, look.art, lite).then(
      (u) => live && setUrls(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [district, look.art, lite]);

  // соседний район — в простое, когда текущий уже на экране
  useEffect(() => {
    if (!urls) return;
    return preloadWhenIdle(() => {
      for (const n of neighbours(district)) void loadDistrict(n, look.art, lite).catch(() => undefined);
    });
  }, [urls, district, look.art, lite]);

  // экран района поверх всего: шапка скрыта, вертикальный свайп Telegram выключен, «Назад» — выход
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("district-open");
    let swipes = false;
    try {
      if (WebApp?.platform !== "unknown" && WebApp.isVersionAtLeast("7.7") && WebApp.isVerticalSwipesEnabled) {
        swipes = true;
        WebApp.disableVerticalSwipes();
      }
    } catch {
      /* вне Telegram */
    }
    // «Назад» — на шаг по полоске: в Центр, в «Прогулку» (выйти совсем — кнопка «Выйти»)
    const off = pushBack(() => districtNav.go(district, "centre", navigate));
    return () => {
      off();
      root.classList.remove("district-open");
      try {
        if (swipes) WebApp.enableVerticalSwipes();
      } catch {
        /* вне Telegram */
      }
    };
  }, [navigate, district]);

  // камера: прямой вход — в центре улицы; из соседнего района — проезд от ближнего края к центру (~0.6 с)
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !urls) return;
    const layers = (): CamLayer[] =>
      [...host.querySelectorAll<HTMLElement>(".dz-layer")].map((el) => ({ el, k: Number(el.dataset.k) || 1 }));
    const still = reducedMotion();
    const cam = new DistrictCamera(host, layers, {
      inertia: !still,
      onEdge: (dir) => {
        const to = neighbourOf(district, dir);
        return !!to && districtNav.go(district, to, navigate);
      },
      onPull: (st) => hintsRef.current?.update(st),
    });
    camRef.current = cam;
    cam.setRange(panRange(window.innerWidth, window.innerHeight));
    const came = districtNav.takeArrival();
    if (came) cam.arrive(came.dir, still ? 0 : ARRIVE_MS);
    else cam.jump(lastX.current ?? 0); // смена фазы суток подменяет рисунок — камера остаётся на месте
    if (import.meta.env.DEV) (window as unknown as { __districtCam?: DistrictCamera }).__districtCam = cam;
    return () => {
      lastX.current = cam.x;
      cam.destroy();
      camRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls]);
  useLayoutEffect(() => {
    camRef.current?.setRange(panRange(vw, vh));
  }, [vw, vh]);

  // жизнь улицы — разовые события; не на слабых устройствах и не при «меньше движения»
  useEffect(() => {
    const mid = midRef.current;
    if (!mid || !urls || lite || !motionAllowed()) return;
    const life = startDistrictLife(mid, LANES[district]);
    if (import.meta.env.DEV) (window as unknown as { __districtSpawn?: unknown }).__districtSpawn = life.spawn;
    return life.stop;
  }, [urls, lite, district]);

  const sw = streetWidth(vw, vh);
  const layers = lite ? [{ id: "flat" as const, k: 1 }] : LAYERS;
  return (
    <div
      ref={hostRef}
      className={`dz${lite ? " dz-lite" : ""}${urls ? " ready" : ""}`}
      data-district={district}
      aria-label={`Район «${DISTRICT_RU[district]}»`}
      data-art={look.art}
      data-tint={look.tint ?? undefined}
      style={{ ["--dz-street" as string]: `${sw}px` } as CSSProperties}
    >
      {urls &&
        layers.map(({ id, k }) => {
          const w = layerBoxWidth(k, vw, vh);
          return (
            <div
              key={id}
              ref={id === "mid" ? midRef : undefined}
              className={`dz-layer dz-${id}`}
              data-k={k}
              style={{ width: w, marginLeft: -w / 2 }}
            >
              <img src={urls[id]} alt="" draggable={false} />
            </div>
          );
        })}
      {look.tint && <div className={`dz-tint ${look.tint}`} aria-hidden="true" />}
      <div className="dz-ui">
        <div className="walk-top">
          <button
            type="button"
            className="walk-exit"
            onClick={() => {
              haptic.tap();
              exit();
            }}
          >
            <i aria-hidden="true">×</i> Выйти
          </button>
        </div>
        <p className="dz-badge" role="status">
          {failed ? "Не удалось загрузить" : urls ? "Черновик" : "Загрузка…"}
        </p>
        <EdgeHints ref={hintsRef} current={district} />
        <DistrictStrip current={district} onGo={go} />
      </div>
    </div>
  );
}
