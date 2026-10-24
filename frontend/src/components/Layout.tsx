import { Outlet } from "react-router-dom";
import { CityBackdrop } from "./CityBackdrop";
import { Nav } from "./Nav";
import { AppHeader } from "./Brand";
import { ToastProvider } from "./ui/index";

export function Layout() {
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
    </ToastProvider>
  );
}
