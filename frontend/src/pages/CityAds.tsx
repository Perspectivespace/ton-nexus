import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCityAds, useDistrictAds, useMe, type CityAdsBoard } from "@/api/hooks";
import type { MeOut } from "@/api/types";
import { BackLink } from "@/components/BackLink";
import { Button, ErrorState, Panel, ScreenHeader, SkeletonCard, Tabs } from "@/components/ui";
import { type SceneSlot } from "@/components/cityads/AdScene";
import { PlaceScene } from "@/components/cityads/DistrictAdScene";
import { BuyFlow } from "@/components/cityads/BuyFlow";
import { MyAds } from "@/components/cityads/MyAds";
import { useScreenBack } from "@/lib/backButton";
import { districtOfSpot, isAdDistrict, spotTitle, tonToNano, ton, type AdDistrict } from "@/lib/cityAdBuy";
import "@/styles/city-ads-buy.css";
import { t, tp } from "@/i18n";

/**
 * «Реклама в городе» (/ads?tab=buy|mine&district=…&spot=…): покупка места (PR 5) и «Мои объявления».
 * Вход — из «Прогулки» и районов (кнопка «Реклама» и касание свободного места). Покупать может игрок любого уровня;
 * если владелец поднял порог (city_ads.min_level), ниже него — понятный замок.
 * Район (PR 6): ?district=centre|rows|port; без него — район места из ?spot=, иначе Центр.
 */
type Tab = "buy" | "mine";

export function CityAds() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get("tab") === "mine" ? "mine" : "buy";
  const spot = sp.get("spot");
  const dq = sp.get("district");
  const district: AdDistrict = isAdDistrict(dq) ? dq : districtOfSpot(spot);
  useScreenBack("/");
  const centre = useCityAds(district === "centre");
  const zone = useDistrictAds(district, district !== "centre");
  const { data: board, isLoading: bl, error: be, refetch } = district === "centre" ? centre : zone;
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
  const setDistrict = (d: AdDistrict) => {
    const n = new URLSearchParams(sp);
    n.set("district", d);
    n.delete("spot");
    setSp(n, { replace: true });
  };

  const minLevel = board?.min_level ?? 1; // по умолчанию — любой уровень; порог может поднять владелец
  const isLocked = locked || (!!me && me.level < minLevel);

  return (
    <div className="cab space-y-4">
      <BackLink to="/" label={t("common.back.home")} />
      <ScreenHeader eyebrow={t("ad.title")} title={tab === "mine" ? t("ad.mine") : t("ad.place")} />
      <Tabs
        kind="blocks"
        label={t("ad.title")}
        items={[
          { value: "buy", label: t("ad.placeShort") },
          { value: "mine", label: t("ad.mine") },
        ]}
        value={tab}
        onChange={(t) => {
          setDone(false);
          setTab(t);
        }}
      />
      {(bl || ml) && <SkeletonCard lines={4} label={t("ad.loading")} />}
      {be && <ErrorState message={t("ad.spotsLoadFail")} onRetry={() => refetch()} />}
      {board && me && tab === "mine" && <MyAds today={board.day} onBuy={() => setTab("buy")} />}
      {board && me && tab === "buy" && isLocked && <Locked board={board} me={me} district={district} />}
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
        <BuyFlow
          key={`${district}:${flowKey}`}
          board={board}
          me={me}
          district={district}
          initialSpot={spot}
          onDistrict={setDistrict}
          onLocked={onLocked}
          onDone={() => setDone(true)}
        />
      )}
    </div>
  );
}

function Locked({ board, me, district }: { board: CityAdsBoard; me: MeOut; district: AdDistrict }) {
  const need = board.min_level ?? 1;
  const cheapest = board.spots
    .filter((s) => s.on_sale && s.price_day)
    .reduce((m, s) => Math.min(m, tonToNano(s.price_day)), Infinity);
  const onSale = board.spots.filter((s) => s.on_sale).length;
  const slots: SceneSlot[] = board.spots.map((s, i) => ({ key: s.key, n: i + 1, state: s.on_sale ? "free" : "off", label: spotTitle(s.key, s.title) }));
  return (
    <div className="space-y-3">
      <PlaceScene district={district} slots={slots} className="cab-dim" label={t("ad.sceneAria")}>
        <span className="cab-lockmark" aria-hidden="true" />
      </PlaceScene>
      <Panel level="hero" className="cab-locked space-y-3 p-4" role="status">
        <p className="ui-label">{t("ad.lockedUntil", { n: need })}</p>
        <p className="ui-h">{t("ad.fromLevel", { n: need })}</p>
        <div className="cab-lvl" aria-label={t("ad.levelAria", { level: me.level, need })}>
          {Array.from({ length: need }, (_, i) => (
            <i key={i} className={i < me.level ? "on" : undefined} />
          ))}
          <span>{t("ad.lvl")}{" "}<b>{me.level}</b> / {need}
          </span>
        </div>
        <p className="cab-note">
          {tp(district === "centre" ? "ad.onSaleCentre" : "ad.onSaleDistrict", onSale)}
          {Number.isFinite(cheapest) ? t("ad.fromPerDay", { cheapest: ton(cheapest) }) : ""}{t("ad.lockedNote")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/tasks" className="ui-btn primary no-underline">{t("ad.toTasks")}</Link>
          <Link to="/miner" className="ui-btn secondary no-underline">{t("city.minerSection")}</Link>
        </div>
      </Panel>
    </div>
  );
}

function Done({ onMine, onMore }: { onMine: () => void; onMore: () => void }) {
  return (
    <Panel level="hero" className="cab-done space-y-3 p-5" role="status">
      <span className="cab-donemark" aria-hidden="true" />
      <p className="ui-h">{t("ad.paidReview")}</p>
      <p className="cab-note">{t("ad.paidReviewNote")}</p>
      <div className="grid gap-2">
        <Button block onClick={onMine}>{t("ad.mine")}</Button>
        <Button block kind="secondary" onClick={onMore}>{t("ad.placeAnother")}</Button>
      </div>
    </Panel>
  );
}
