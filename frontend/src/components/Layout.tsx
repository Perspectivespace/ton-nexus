import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { cityWalk } from "@/lib/cityWalk";
import { useLangSync, useMe, useOnboardingSave } from "@/api/hooks";
import { hintToShow, introDecision, useOnboardingUi, type HintKey } from "@/lib/onboarding";
import { SectionHint } from "./SectionHint";
import { districtFromStart } from "@/lib/districts";
import { WebApp } from "@/lib/telegram";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useRouteBackFallback } from "@/lib/backButton";
import { CityBackdrop } from "./CityBackdrop";
import { Nav, isDockRoute } from "./Nav";
import { AppHeader } from "./Brand";
import { Splash, shouldShowSplash } from "./Splash";
import { markDone, shouldShowOnboarding } from "./onboardingFlag";

// знакомство нужно только при первом запуске — его чанк начинает грузиться сразу, пока играет заставка
const loadOnboarding = () => import("./Onboarding");
if (shouldShowOnboarding()) void loadOnboarding();
const Onboarding = lazy(() => loadOnboarding().then((m) => ({ default: m.Onboarding })));
import { ToastProvider } from "./ui/index";
import { AchCelebration } from "./achievements/AchCelebration";

export function Layout() {
  const [splash, setSplash] = useState(shouldShowSplash);
  const endSplash = useCallback(() => setSplash(false), []);
  useLangSync();
  // DESIGN п. 14.2: док только на четырёх разделах; на вложенных экранах — «Назад» (Telegram или ссылка)
  const loc = useLocation();
  const dock = isDockRoute(loc.pathname);
  useRouteBackFallback(!dock);

  // знакомство: что показано, хранит сервер (me.onboarding); отметка на устройстве — запасная (lib/onboarding.ts)
  const { data: me, isError: meFailed } = useMe();
  const save = useOnboardingSave();
  const replay = useOnboardingUi((s) => s.replay);
  const endReplay = useOnboardingUi((s) => s.endReplay);
  const [introClosed, setIntroClosed] = useState(false);
  const decision = introDecision(me?.onboarding, meFailed, !shouldShowOnboarding());
  const onboarding = replay || (decision === "show" && !introClosed);
  useEffect(() => {
    if (decision === "resync" && !save.isPending) save.mutate({ intro_done: true });
  }, [decision]);
  const endOnboarding = () => {
    markDone();
    setIntroClosed(true);
    endReplay();
    save.mutate({ intro_done: true });
  };
  // разовые подсказки разделов: после заставки и знакомства, с паузой — экран успевает отрисоваться
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const due = splash || onboarding ? null : hintToShow(loc.pathname, me?.onboarding, dismissed);
  const [hint, setHint] = useState<HintKey | null>(null);
  useEffect(() => {
    setHint(null);
    if (!due) return;
    const id = window.setTimeout(() => setHint(due), 700);
    return () => window.clearTimeout(id);
  }, [due]);
  const closeHint = (k: HintKey) => {
    setHint(null);
    setDismissed((d) => new Set(d).add(k));
    save.mutate({ hint: k });
  };
  // «Прогулка» живёт только на главной: уход на другой экран её закрывает
  useEffect(() => {
    if (loc.pathname !== "/" && cityWalk.get().active) cityWalk.exit();
  }, [loc.pathname]);
  // прямая ссылка на район (start_param «district-rows» / «district-port») — открыта всем игрокам
  const navigate = useNavigate();
  useEffect(() => {
    let sp: string | null | undefined = null;
    try {
      sp = new URLSearchParams(location.search).get("tgWebAppStartParam") ?? WebApp?.initDataUnsafe?.start_param;
    } catch {
      /* вне Telegram */
    }
    const d = districtFromStart(sp);
    if (d && window.location.pathname === "/") navigate(`/district?d=${d}`, { replace: true });
  }, []);
  return (
    <ToastProvider>
      <div className="app-shell flex flex-col">
        <CityBackdrop />
        <AppHeader />
        <main className={`app-stage mx-auto w-full max-w-lg flex-1 px-4 pt-4 ${dock ? "pb-32" : "pb-[calc(32px+var(--safe-b,0px))]"}`}>
          <Outlet />
        </main>
        {dock && <Nav />}
      </div>
      {hint && dock && <SectionHint hint={hint} onClose={() => closeHint(hint)} />}
      {onboarding && (
        <Suspense fallback={null}>
          <Onboarding onDone={endOnboarding} />
        </Suspense>
      )}
      {/* новая ступень достижений — после заставки и знакомства, не поверх подсказки раздела */}
      <AchCelebration enabled={!!me && !splash && !onboarding && !hint} />
      {splash && <Splash onDone={endSplash} />}
    </ToastProvider>
  );
}
