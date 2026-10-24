import { Outlet } from "react-router-dom";
import { CityBackdrop } from "./CityBackdrop";
import { Nav } from "./Nav";
import { ToastProvider } from "./ui/index";

export function Layout() {
  return (
    <ToastProvider>
      <div className="app-shell flex flex-col">
        <CityBackdrop />
        <main className="app-stage mx-auto w-full max-w-lg flex-1 px-4 pb-32 pt-5">
          <Outlet />
        </main>
        <Nav />
      </div>
    </ToastProvider>
  );
}
