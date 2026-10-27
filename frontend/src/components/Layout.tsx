import { lazy, Suspense, useCallback, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CityBackdrop } from "./CityBackdrop";
import { Nav, isDockRoute } from "./Nav";
import { AppHeader } from "./Brand";
import { Splash, shouldShowSplash } from "./Splash";
import { shouldShowOnboarding } from "./onboardingFlag";

// знакомство нужно только при первом запуске — его чанк начинает грузиться сразу, пока играет заставка
const loadOnboarding = () => import("./Onboarding");
if (shouldShowOnboarding()) void loadOnboarding();
const Onboarding = lazy(() => loadOnboarding().then((m) => ({ default: m.Onboarding })));
import { ToastProvider } from "./ui/index";

export function Layout() {
  const [splash, setSplash] = useState(shouldShowSplash);
  const [onboarding, setOnboarding] = useState(shouldShowOnboarding);
  const endSplash = useCallback(() => setSplash(false), []);
  const endOnboarding = useCallback(() => setOnboarding(false), []);
  // DESIGN п. 14.3: док только на четырёх разделах; на вложенных экранах — «Назад» (Telegram или ссылка)
  const loc = useLocation();
  const dock = isDockRoute(loc.pathname);
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
      {onboarding && (
        <Suspense fallback={null}>
          <Onboarding onDone={endOnboarding} />
        </Suspense>
      )}
      {splash && <Splash onDone={endSplash} />}
    </ToastProvider>
  );
}
