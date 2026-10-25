import { useCallback, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CityBackdrop, viaBuilding } from "./CityBackdrop";
import { StreetBack } from "./CityBuildings";
import { buildingAt } from "@/lib/buildings";
import { Nav, isDockRoute } from "./Nav";
import { AppHeader } from "./Brand";
import { Splash, shouldShowSplash } from "./Splash";
import { Onboarding, shouldShowOnboarding } from "./Onboarding";
import { ToastProvider } from "./ui/index";

export function Layout() {
  const [splash, setSplash] = useState(shouldShowSplash);
  const [onboarding, setOnboarding] = useState(shouldShowOnboarding);
  const endSplash = useCallback(() => setSplash(false), []);
  const endOnboarding = useCallback(() => setOnboarding(false), []);
  // DESIGN п. 14.3: док только на четырёх разделах; на вложенных экранах — «Назад» (Telegram или ссылка)
  const loc = useLocation();
  const dock = isDockRoute(loc.pathname);
  // п. 3.8.3: вошли в раздел через здание (башня → «Майнер») — «Назад» ведёт на улицу с отъездом камеры
  const fromStreet = viaBuilding(loc.state, buildingAt(loc.pathname)?.id);
  return (
    <ToastProvider>
      <div className="app-shell flex flex-col">
        <CityBackdrop />
        <AppHeader />
        <main className={`app-stage mx-auto w-full max-w-lg flex-1 px-4 pt-4 ${dock ? "pb-32" : "pb-[calc(32px+var(--safe-b,0px))]"}`}>
          <StreetBack active={fromStreet} />
          <Outlet />
        </main>
        {dock && <Nav />}
      </div>
      {onboarding && <Onboarding onDone={endOnboarding} />}
      {splash && <Splash onDone={endSplash} />}
    </ToastProvider>
  );
}
