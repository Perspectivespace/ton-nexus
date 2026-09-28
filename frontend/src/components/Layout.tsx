import { Outlet } from "react-router-dom";
import { Nav } from "./Nav";

export function Layout() {
  return (
    <div className="app-shell flex flex-col">
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>
      <Nav />
    </div>
  );
}
