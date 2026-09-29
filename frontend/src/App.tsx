import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Home } from "@/pages/Home";
import { Miner } from "@/pages/Miner";
import { Tasks } from "@/pages/Tasks";
import { TaskDetail } from "@/pages/TaskDetail";
import { Wallet } from "@/pages/Wallet";
import { Upgrade } from "@/pages/Upgrade";
import { Wheel } from "@/pages/Wheel";
import { Owner } from "@/pages/Owner";
import { Inbox } from "@/pages/Inbox";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/miner" element={<Miner />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/upgrade" element={<Upgrade />} />
          <Route path="/wheel" element={<Wheel />} />
          <Route path="/owner" element={<Owner />} />
          <Route path="/inbox" element={<Inbox />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
