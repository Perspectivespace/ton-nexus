import { useState } from "react";
import { useCityAdCancel, useCityAdLink, useMyCityAds, type CityAdMine } from "@/api/hooks";
import { Button, EmptyState, ErrorState, Field, Panel, Sheet, SkeletonCard, Tag } from "@/components/ui";
import { adVars } from "@/lib/cityAdPalette";
import { linkHost } from "@/lib/cityAdLink";
import { haptic } from "@/lib/haptics";
import {
  SPOT_SHORT,
  canCancel,
  canEditLink,
  daysWord,
  fmtRange,
  linkHint,
  statusView,
  ton,
} from "@/lib/cityAdBuy";
import { AdScene, cropAround } from "./AdScene";

/** «Мои объявления»: статус, даты, счётчики «Прогулки», отмена до проверки, смена ссылки. */
export function MyAds({ today, onBuy }: { today: string; onBuy: () => void }) {
  const { data, isLoading, error, refetch } = useMyCityAds();
  const [edit, setEdit] = useState<CityAdMine | null>(null);
  if (isLoading) return <SkeletonCard lines={3} label="Загрузка" />;
  if (error) return <ErrorState message="Не удалось загрузить объявления" onRetry={() => refetch()} />;
  if (!data?.length)
    return (
      <EmptyState
        title="Пока нет объявлений"
        body="Вывеска, голо-баннер или строка на башне — их увидят все, кто гуляет по городу."
        action={
          <Button className="mt-2" onClick={onBuy}>
            Разместить рекламу
          </Button>
        }
      />
    );
  return (
    <div className="space-y-3">
      {data.map((ad) => (
        <MyAdItem key={ad.id} ad={ad} today={today} onEdit={() => setEdit(ad)} />
      ))}
      <LinkSheet ad={edit} today={today} onClose={() => setEdit(null)} />
    </div>
  );
}

export function AdStats({ ad }: { ad: Pick<CityAdMine, "stats"> }) {
  const s = ad.stats ?? {};
  const views = s.impression ?? 0;
  const clicks = s.click ?? 0;
  return (
    <div className="cab-stats">
      <span>
        <b>{views}</b>показы
      </span>
      <span>
        <b>{s.open ?? 0}</b>открытия
      </span>
      <span>
        <b>{clicks}</b>переходы
      </span>
      <span>
        <b>{views ? `${((clicks / views) * 100).toFixed(1)}%` : "—"}</b>CTR
      </span>
    </div>
  );
}

function MyAdItem({ ad, today, onEdit }: { ad: CityAdMine; today: string; onEdit: () => void }) {
  const st = statusView(ad, today);
  const cancel = useCityAdCancel();
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closed = ["rejected", "cancelled", "expired"].includes(ad.status);
  return (
    <Panel className={`cab-ad space-y-3 p-3${closed ? " closed" : ""}`} style={adVars(ad.color)}>
      <div className="cab-ad-head">
        <AdScene
          crop={cropAround(ad.spot, ad.format === "line" ? 2.6 : 3, 1.5)}
          sign={{ spot: ad.spot, format: ad.format, ad: { title: ad.title, subtitle: ad.subtitle, color: ad.color } }}
          className="cab-thumb"
          label={`Вывеска «${ad.title}»`}
        />
        <div className="min-w-0 flex-1">
          <Tag tone={st.tone}>{st.label}</Tag>
          <p className="cab-ad-t">{ad.title}</p>
          <p className="cab-ad-s">
            {SPOT_SHORT[ad.spot] ?? ad.spot} · {fmtRange(ad.start, ad.end)} · {daysWord(ad.days)}
          </p>
        </div>
      </div>
      {ad.moderation_note && (ad.status === "rejected" || ad.status === "pending") && (
        <p className="cab-reason">
          <span>{ad.status === "rejected" ? "Причина" : "Комментарий"}</span>
          {ad.moderation_note}
        </p>
      )}
      {(ad.status === "approved" || ad.status === "expired" || (ad.stats && (ad.stats.impression ?? 0) > 0)) && <AdStats ad={ad} />}
      <div className="cab-ad-money">
        <span>
          Оплачено <b>{ad.paid} TON</b>
        </span>
        {ad.refunded_nano > 0 && (
          <span>
            Возвращено <b>{ad.refunded} TON</b>
          </span>
        )}
        {ad.link_url && <span className="cab-ad-link">{linkHost(ad.link_url)}</span>}
      </div>
      {err && <p className="ui-fhint err">{err}</p>}
      {ask ? (
        <div className="cab-ask" role="alertdialog" aria-label="Отмена объявления">
          <p>
            Отменить объявление? <b>{ton(ad.paid_nano - ad.refunded_nano)}</b> вернутся на баланс, сутки освободятся.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              kind="danger"
              size="sm"
              disabled={cancel.isPending}
              onClick={async () => {
                setErr(null);
                try {
                  await cancel.mutateAsync(ad.id);
                  haptic.collect();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Не удалось отменить");
                }
                setAsk(false);
              }}
            >
              Отменить и вернуть
            </Button>
            <Button kind="secondary" size="sm" onClick={() => setAsk(false)}>
              Оставить
            </Button>
          </div>
        </div>
      ) : (
        (canCancel(ad) || canEditLink(ad, today)) && (
          <div className="cab-ad-act">
            {canEditLink(ad, today) && (
              <Button kind="secondary" size="sm" onClick={onEdit}>
                Изменить ссылку
              </Button>
            )}
            {canCancel(ad) && (
              <Button kind="ghost" size="sm" onClick={() => setAsk(true)}>
                Отменить
              </Button>
            )}
          </div>
        )
      )}
    </Panel>
  );
}

function LinkSheet({ ad, today, onClose }: { ad: CityAdMine | null; today: string; onClose: () => void }) {
  return (
    <Sheet open={!!ad} onClose={onClose} title="Ссылка объявления" sub={ad ? `«${ad.title}»` : undefined}>
      {ad && <LinkForm key={ad.id} ad={ad} today={today} onDone={onClose} />}
    </Sheet>
  );
}

function LinkForm({ ad, onDone }: { ad: CityAdMine; today: string; onDone: () => void }) {
  const [v, setV] = useState(ad.link_url ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = useCityAdLink();
  const hint = linkHint(v);
  const same = v.trim() === (ad.link_url ?? "");
  return (
    <div className="space-y-3 pb-2">
      {ad.status === "approved" && (
        <div className="cab-warn amber" role="note">
          <span>
            После смены ссылки объявление <b>снова уйдёт на проверку</b> и не будет показываться в городе, пока его не одобрят.
          </span>
        </div>
      )}
      <Field label="Новая ссылка" error={hint ?? err} hint="Только https:// или t.me/… · без сокращателей · пусто — без ссылки">
        <input
          className="ui-input"
          value={v}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://… или t.me/канал"
          onChange={(e) => {
            setV(e.target.value);
            setErr(null);
          }}
        />
      </Field>
      <Button
        block
        size="lg"
        disabled={!!hint || same || save.isPending}
        onClick={async () => {
          try {
            await save.mutateAsync({ id: ad.id, link_url: v.trim() || null });
            haptic.collect();
            onDone();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Не удалось сохранить");
          }
        }}
      >
        {ad.status === "approved" ? "Сохранить и отправить на проверку" : "Сохранить"}
      </Button>
    </div>
  );
}
