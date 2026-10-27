import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Home } from "@/pages/Home";
import { route } from "@/lib/routes";

// Витрина набора компонентов — только в dev-сборке, в прод не попадает
const Kit = import.meta.env.DEV ? lazy(() => import("@/pages/Kit")) : null;

/** Главная — в стартовом чанке; разделы — отдельными чанками с предзагрузкой (lib/routes.tsx) */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/miner" element={route("miner")} />
          <Route path="/tasks" element={route("tasks")} />
          <Route path="/tasks/new" element={route("taskCreate")} />
          <Route path="/tasks/:id" element={route("taskDetail")} />
          <Route path="/wallet" element={route("wallet")} />
          <Route path="/upgrade" element={route("upgrade")} />
          <Route path="/wheel" element={route("wheel")} />
          <Route path="/owner" element={route("owner")} />
          <Route path="/inbox" element={route("inbox")} />
          <Route path="/withdraws" element={route("withdraws")} />
          <Route path="/deploy" element={route("deploy")} />
          <Route path="/tower" element={route("tower")} />
          {Kit && (
            <Route
              path="/kit"
              element={
                <Suspense fallback={null}>
                  <Kit />
                </Suspense>
              }
            />
          )}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
