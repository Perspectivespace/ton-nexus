import { useState } from "react";
import {
  useCityAdApprove,
  useCityAdModeration,
  useCityAdReject,
  useCityAds,
  type CityAdOwner,
} from "@/api/hooks";
import { Button, EmptyState, ErrorState, Field, Panel, SkeletonCard, StatTile, Tabs, Tag } from "@/components/ui";
import { AdCardPreview } from "@/components/cityads/AdCardPreview";
import { PlaceScene } from "@/components/cityads/DistrictAdScene";
import { AdStats } from "@/components/cityads/MyAds";
import { linkHost } from "@/lib/cityAdLink";
import { adVars } from "@/lib/cityAdPalette";
import { haptic } from "@/lib/haptics";
import {
  districtOfSpot,
  adTimeline,
  daysWord,
  fmtDayShort,
  fmtRange,
  refundOnReject,
  spotName,
  ton,
  unshownDays,
} from "@/lib/cityAdBuy";
import "@/styles/city-ads-buy.css";

/**
 * Кабинет владельца → «Реклама»: очередь проверки с превью, одобрить / отклонить с причиной,
 * в эфире и впереди (снятие одобренного — возврат за непоказанные сутки, как на сервере), доход и счётчики.
 */
type View = "queue" | "live" | "next";
const REASONS = ["Ссылка не открывается", "Запрещённый контент", "Вводит в заблуждение", "Текст нечитаем"];

export function CityAdsOwner() {
  const [view, setView] = useState<View>("queue");
  const { data: board } = useCityAds();
  const today = board?.day ?? new Date().toISOString().slice(0, 10);
  const pending = useCityAdModeration("pending");
  const approved = useCityAdModeration("approved");
  const appr = approved.data?.items ?? [];
  const live = appr.filter((a) => adTimeline(a, today) === "live");
  const next = appr.filter((a) => adTimeline(a, today) === "upcoming");
  const queue = pending.data?.items ?? [];
  const sum = (k: "impression" | "open" | "click") => live.reduce((n, a) => n + (a.stats?.[k] ?? 0), 0);
  const held = [...appr, ...queue].reduce((n, a) => n + a.held_nano, 0);
  const revenue = pending.data?.revenue_total_nano ?? approved.data?.revenue_total_nano ?? 0;

  const list = view === "queue" ? queue : view === "live" ? live : next;
  const q = view === "queue" ? pending : approved;

  return (
    <div className="cab cab-own space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Доход с рекламы" value={ton(revenue)} sub="за всё время" state="focus" />
        <StatTile label="Удержано" value={ton(held)} sub="до показа / проверки" />
        <StatTile label="На проверке" value={String(queue.length)} sub={queue.length ? "ждут решения" : "очередь пуста"} />
        <StatTile label="В эфире · впереди" value={`${live.length} · ${next.length}`} sub={`${sum("impression")} пок. · ${sum("click")} перех.`} />
      </div>
      <Tabs
        kind="blocks"
        label="Реклама"
        items={[
          { value: "queue", label: `Проверка${queue.length ? ` · ${queue.length}` : ""}` },
          { value: "live", label: "В эфире" },
          { value: "next", label: "Впереди" },
        ]}
        value={view}
        onChange={setView}
      />
      {q.isLoading && <SkeletonCard lines={3} label="Загрузка" />}
      {q.error && <ErrorState message="Не удалось загрузить объявления" onRetry={() => q.refetch()} />}
      {!q.isLoading && !q.error && !list.length && (
        <EmptyState
          title={view === "queue" ? "Очередь пуста" : view === "live" ? "Сейчас в городе нет рекламы" : "Впереди ничего нет"}
          body={view === "queue" ? "Новые объявления появятся здесь сразу после оплаты." : undefined}
        />
      )}
      {list.map((ad) => (
        <OwnerAd key={ad.id} ad={ad} today={today} mode={view} />
      ))}
    </div>
  );
}

function OwnerAd({ ad, today, mode }: { ad: CityAdOwner; today: string; mode: View }) {
  const approve = useCityAdApprove();
  const reject = useCityAdReject();
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const pending = ad.status === "pending";
  const refund = refundOnReject(ad, today);
  const left = unshownDays(ad, today);
  const busy = approve.isPending || reject.isPending;

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      haptic.collect();
    } catch (e) {
      haptic.heavy();
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  };

  return (
    <Panel className="cab-mod space-y-3 p-3" style={adVars(ad.color)}>
      <div className="cab-mod-head">
        <span className="cab-mod-id">#{ad.id}</span>
        <span className="min-w-0 flex-1 truncate">
          {spotName(ad.spot, ad.spot_title, ad.district)} · {fmtRange(ad.start, ad.end)}
        </span>
        {pending && ad.moderated ? (
          <Tag tone="amber">Новая ссылка</Tag>
        ) : mode === "live" ? (
          <Tag tone="ok">В эфире</Tag>
        ) : mode === "next" ? (
          <Tag tone="neon">С {fmtDayShort(ad.start)}</Tag>
        ) : (
          <Tag tone="amber">Проверка</Tag>
        )}
      </div>
      <PlaceScene
        district={ad.district ?? districtOfSpot(ad.spot)}
        spot={ad.spot}
        zoom={ad.format === "line" ? 2.4 : 2.6}
        aspect={2.2}
        sign={{ spot: ad.spot, format: ad.format, ad: { title: ad.title, subtitle: ad.subtitle, color: ad.color } }}
        label={`Вывеска «${ad.title}»`}
      />
      {pending && (
        <AdCardPreview format={ad.format} title={ad.title} subtitle={ad.subtitle} body={ad.body} link={ad.link_url} linkKind={ad.link_kind} color={ad.color} days={ad.days} />
      )}
      {pending && ad.link_url && (
        <p className="cab-fulllink">
          <span>{ad.link_kind === "telegram" ? "Telegram" : "Сайт"}</span>
          {ad.link_url}
        </p>
      )}
      {!pending && <AdStats ad={ad} />}
      <div className="cab-ad-money">
        <span>
          Рекламодатель <b>#{ad.advertiser_id}</b>
        </span>
        <span>
          Оплачено <b>{ad.paid} TON</b> · {daysWord(ad.days)}
        </span>
        {!pending && ad.link_url && <span className="cab-ad-link">{linkHost(ad.link_url)}</span>}
      </div>
      {err && <p className="ui-fhint err">{err}</p>}
      {ask ? (
        <div className="cab-ask space-y-2" role="alertdialog" aria-label={pending ? "Отклонить объявление" : "Снять с показа"}>
          <Field label="Причина — её увидит рекламодатель" unit={<span className="cab-count">{note.length}/300</span>}>
            <input className="ui-input" value={note} maxLength={300} placeholder="Коротко, что не так" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="cab-chips" role="group" aria-label="Частые причины">
            {REASONS.map((r) => (
              <button key={r} type="button" className={note === r ? "on" : undefined} onClick={() => setNote(r)}>
                {r}
              </button>
            ))}
          </div>
          <p className="cab-note">
            {pending
              ? `Вернём рекламодателю ${ton(refund)}, сутки освободятся.`
              : `Снимем с показа сразу. Вернём ${ton(refund)} за ${daysWord(left)} без показа; показанные сутки остаются доходом.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              kind="danger"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await reject.mutateAsync({ id: ad.id, note: note.trim() });
                  setAsk(false);
                })
              }
            >
              {pending ? "Отклонить" : "Снять"} · −{ton(refund)}
            </Button>
            <Button kind="secondary" size="sm" onClick={() => setAsk(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <div className="cab-ad-act">
          {pending && (
            <Button size="sm" disabled={busy} onClick={() => act(() => approve.mutateAsync(ad.id))}>
              Одобрить
            </Button>
          )}
          <Button kind={pending ? "secondary" : "danger"} size="sm" disabled={busy} onClick={() => setAsk(true)}>
            {pending ? "Отклонить" : "Снять с показа"}
          </Button>
        </div>
      )}
    </Panel>
  );
}
