import { Outlet } from "react-router-dom";
import { Nav } from "./Nav";

export function Layout() {
  return (
    <div className="app-shell flex flex-col">
      <main className="app-stage mx-auto w-full max-w-lg flex-1 px-4 pb-32 pt-5">
        <Outlet />
      </main>
      <Nav />
    </div>
  );
}
