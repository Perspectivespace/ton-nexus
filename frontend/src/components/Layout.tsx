import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import { CityBackdrop } from "./CityBackdrop";
import { Nav } from "./Nav";
import { AppHeader } from "./Brand";
import { Splash, shouldShowSplash } from "./Splash";
import { Onboarding, shouldShowOnboarding } from "./Onboarding";
import { ToastProvider } from "./ui/index";

export function Layout() {
  const [splash, setSplash] = useState(shouldShowSplash);
  const [onboarding, setOnboarding] = useState(shouldShowOnboarding);
  const endSplash = useCallback(() => setSplash(false), []);
  const endOnboarding = useCallback(() => setOnboarding(false), []);
  return (
    <ToastProvider>
      <div className="app-shell flex flex-col">
        <CityBackdrop />
        <AppHeader />
        <main className="app-stage mx-auto w-full max-w-lg flex-1 px-4 pb-32 pt-4">
          <Outlet />
        </main>
        <Nav />
      </div>
      {onboarding && <Onboarding onDone={endOnboarding} />}
      {splash && <Splash onDone={endSplash} />}
    </ToastProvider>
  );
}
