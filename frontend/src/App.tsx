import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Home } from "@/pages/Home";
import { Miner } from "@/pages/Miner";
import { Tasks } from "@/pages/Tasks";
import { TaskDetail } from "@/pages/TaskDetail";
import { TaskCreate } from "@/pages/TaskCreate";
import { Wallet } from "@/pages/Wallet";
import { Upgrade } from "@/pages/Upgrade";
import { Wheel } from "@/pages/Wheel";
import { Owner } from "@/pages/Owner";
import { Inbox } from "@/pages/Inbox";
import { WithdrawQueue } from "@/pages/WithdrawQueue";
import { Deploy } from "@/pages/Deploy";

// Витрина набора компонентов — только в dev-сборке, в прод не попадает
const Kit = import.meta.env.DEV ? lazy(() => import("@/pages/Kit")) : null;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/miner" element={<Miner />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/new" element={<TaskCreate />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/upgrade" element={<Upgrade />} />
          <Route path="/wheel" element={<Wheel />} />
          <Route path="/owner" element={<Owner />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/withdraws" element={<WithdrawQueue />} />
          <Route path="/deploy" element={<Deploy />} />
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
