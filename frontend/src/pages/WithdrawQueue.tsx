import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useMe, usePayoutConfig, usePendingWithdrawals } from "@/api/hooks";
import { ScreenHeader, StatusPill, LoadingPanel, ErrorPanel, EmptyPanel, Tabs } from "@/components/ui";
import { WithdrawCard } from "@/components/WithdrawCard";
import { LazyTonConnectProvider } from "@/lib/tonconnect";
import { useScreenBack } from "@/lib/backButton";
import { BackLink } from "@/components/BackLink";
import { TowerPrizesAdmin } from "@/components/TowerPrizesAdmin";
import { DepositsAdmin } from "@/components/DepositsAdmin";

export function WithdrawQueue() {
  useScreenBack("/");
  const { data: me, isLoading: meLoading } = useMe();
  const q = usePendingWithdrawals();
  const [tab, setTab] = useState<"withdraw" | "deposits">("withdraw");

  const allowed = me?.is_owner || me?.is_admin;
  const cfg = usePayoutConfig(!!allowed);

  if (meLoading || q.isLoading) {
    return <LoadingPanel label="Загрузка очереди выводов…" />;
  }

  if (!allowed) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Управление" title="Касса" />
        <ErrorPanel message="Очередь доступна только владельцу и админам." />
        <BackLink />
      </div>
    );
  }

  if (q.isError) {
    return <ErrorPanel message="Не удалось загрузить заявки на вывод" />;
  }

  const list = q.data || [];

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Управление"
        title="Касса"
        action={
          <StatusPill tone={list.length ? "warn" : "ok"}>
            {list.length} в холде
          </StatusPill>
        }
      />

      <Tabs
        label="Раздел кассы"
        items={[
          { value: "withdraw", label: "Вывод" },
          { value: "deposits", label: "Пополнения" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "deposits" ? (
        <DepositsAdmin isOwner={!!me?.is_owner} />
      ) : (
        <>
          <div className="ui-cut hero p-4">
            <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
              TON уже списаны с баланса и лежат в холде. «Выплатить» — перевод с
              кошелька выплат через TON Connect; заявка закроется сама, когда
              сервер найдёт его в сети. «Отклонить» — TON вернутся пользователю.
            </p>
          </div>

          {list.length === 0 && (
            <EmptyPanel
              title="Очередь пуста"
              body="Нет заявок, ждущих решения. Новые появятся здесь."
            />
          )}

          {list.length > 0 && (
            <LazyTonConnectProvider fallback={<p className="ui-sec">Загрузка…</p>}>
              <AnimatePresence mode="popLayout">
                {list.map((item) => (
                  <WithdrawCard
                    key={item.id}
                    item={item}
                    config={cfg.data}
                    isOwner={!!me?.is_owner}
                    onDone={() => q.refetch()}
                  />
                ))}
              </AnimatePresence>
            </LazyTonConnectProvider>
          )}

          {/* призы «Башни» — решает и платит только владелец */}
          {me?.is_owner ? <TowerPrizesAdmin /> : null}
        </>
      )}

      <BackLink />
    </div>
  );
}
