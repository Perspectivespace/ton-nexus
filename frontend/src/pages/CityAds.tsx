import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCityAds, useMe, type CityAdsBoard } from "@/api/hooks";
import type { MeOut } from "@/api/types";
import { BackLink } from "@/components/BackLink";
import { Button, ErrorState, Panel, ScreenHeader, SkeletonCard, Tabs } from "@/components/ui";
import { AdScene, CROP_ALL, type SceneSlot } from "@/components/cityads/AdScene";
import { BuyFlow } from "@/components/cityads/BuyFlow";
import { MyAds } from "@/components/cityads/MyAds";
import { useScreenBack } from "@/lib/backButton";
import { tonToNano, ton } from "@/lib/cityAdBuy";
import "@/styles/city-ads-buy.css";

/**
 * «Реклама в городе» (/ads?tab=buy|mine&spot=…): покупка места (PR 5) и «Мои объявления».
 * Вход — из «Прогулки» (кнопка «Реклама» и касание свободного места). Ниже минимального уровня — понятный замок.
 */
type Tab = "buy" | "mine";

export function CityAds() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get("tab") === "mine" ? "mine" : "buy";
  const spot = sp.get("spot");
  useScreenBack("/");
  const { data: board, isLoading: bl, error: be, refetch } = useCityAds();
  const { data: me, isLoading: ml } = useMe();
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const [flowKey, setFlowKey] = useState(0);
  const setTab = (t: Tab) => {
    const n = new URLSearchParams(sp);
    n.set("tab", t);
    setSp(n, { replace: true });
  };
  const onLocked = useCallback(() => setLocked(true), []);

  const minLevel = board?.min_level ?? 3;
  const isLocked = locked || (!!me && me.level < minLevel);

  return (
    <div className="cab space-y-4">
      <BackLink to="/" label="Контур" />
      <ScreenHeader eyebrow="Реклама в городе" title={tab === "mine" ? "Мои объявления" : "Разместить рекламу"} />
      <Tabs
        kind="blocks"
        label="Реклама в городе"
        items={[
          { value: "buy", label: "Разместить" },
          { value: "mine", label: "Мои объявления" },
        ]}
        value={tab}
        onChange={(t) => {
          setDone(false);
          setTab(t);
        }}
      />
      {(bl || ml) && <SkeletonCard lines={4} label="Загрузка" />}
      {be && <ErrorState message="Не удалось загрузить места" onRetry={() => refetch()} />}
      {board && me && tab === "mine" && <MyAds today={board.day} onBuy={() => setTab("buy")} />}
      {board && me && tab === "buy" && isLocked && <Locked board={board} me={me} />}
      {board && me && tab === "buy" && !isLocked && done && (
        <Done
          onMine={() => {
            setDone(false);
            setTab("mine");
          }}
          onMore={() => {
            setDone(false);
            setFlowKey((k) => k + 1);
          }}
        />
      )}
      {board && me && tab === "buy" && !isLocked && !done && (
        <BuyFlow key={flowKey} board={board} me={me} initialSpot={spot} onLocked={onLocked} onDone={() => setDone(true)} />
      )}
    </div>
  );
}

function Locked({ board, me }: { board: CityAdsBoard; me: MeOut }) {
  const need = board.min_level ?? 3;
  const cheapest = board.spots
    .filter((s) => s.on_sale && s.price_day)
    .reduce((m, s) => Math.min(m, tonToNano(s.price_day)), Infinity);
  const slots: SceneSlot[] = board.spots.map((s, i) => ({ key: s.key, n: i + 1, state: s.on_sale ? "free" : "off", label: s.title }));
  return (
    <div className="space-y-3">
      <AdScene crop={CROP_ALL} slots={slots} className="cab-dim" label="Места для рекламы в городе">
        <span className="cab-lockmark" aria-hidden="true" />
      </AdScene>
      <Panel level="hero" className="cab-locked space-y-3 p-4" role="status">
        <p className="ui-label">Закрыто до {need}-го уровня</p>
        <p className="ui-h">Реклама в городе — с {need}-го уровня</p>
        <div className="cab-lvl" aria-label={`Ваш уровень ${me.level} из ${need}`}>
          {Array.from({ length: need }, (_, i) => (
            <i key={i} className={i < me.level ? "on" : undefined} />
          ))}
          <span>
            ур. <b>{me.level}</b> / {need}
          </span>
        </div>
        <p className="cab-note">
          {board.spots.filter((s) => s.on_sale).length} мест в городе
          {Number.isFinite(cheapest) ? ` · от ${ton(cheapest)} за сутки` : ""}. Опыт дают задания и майнер — поднимите уровень, и места откроются.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/tasks" className="ui-btn primary no-underline">
            К заданиям
          </Link>
          <Link to="/miner" className="ui-btn secondary no-underline">
            Майнер
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function Done({ onMine, onMore }: { onMine: () => void; onMore: () => void }) {
  return (
    <Panel level="hero" className="cab-done space-y-3 p-5" role="status">
      <span className="cab-donemark" aria-hidden="true" />
      <p className="ui-h">Оплачено — объявление на проверке</p>
      <p className="cab-note">
        Владелец проверит текст и ссылку. После одобрения вывеска появится в городе в первый день показа. Если не одобрят — TON вернутся на баланс.
      </p>
      <div className="grid gap-2">
        <Button block onClick={onMine}>
          Мои объявления
        </Button>
        <Button block kind="secondary" onClick={onMore}>
          Разместить ещё одно
        </Button>
      </div>
    </Panel>
  );
}
