import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthImage, useCityAdCancel, useCityAdLink, useCityAdSetImage, useMyCityAds, type CityAdMine } from "@/api/hooks";
import { Button, EmptyState, ErrorState, Field, Panel, Sheet, SkeletonCard, Tag } from "@/components/ui";
import { adVars } from "@/lib/cityAdPalette";
import { linkHost } from "@/lib/cityAdLink";
import { haptic } from "@/lib/haptics";
import {
  districtOfSpot,
  canCancel,
  canEditLink,
  daysWord,
  fmtRange,
  linkHint,
  spotName,
  statusView,
  streetLink,
  ton,
} from "@/lib/cityAdBuy";
import { PlaceScene } from "./DistrictAdScene";
import { FacadeImagePicker, type FacadePick } from "./FacadeImage";
import { quote, t } from "@/i18n";

/** «Мои объявления»: статус, даты, счётчики «Прогулки», отмена до проверки, смена ссылки и картинки экрана. */
export function MyAds({ today, onBuy }: { today: string; onBuy: () => void }) {
  const { data, isLoading, error, refetch } = useMyCityAds();
  const [edit, setEdit] = useState<CityAdMine | null>(null);
  const [pic, setPic] = useState<CityAdMine | null>(null);
  if (isLoading) return <SkeletonCard lines={3} label={t("ad.loading")} />;
  if (error) return <ErrorState message={t("ad.mineLoadFail")} onRetry={() => refetch()} />;
  if (!data?.length)
    return (
      <EmptyState
        title={t("ad.mineEmpty")}
        body={t("ad.mineEmptyHint")}
        action={
          <Button className="mt-2" onClick={onBuy}>{t("ad.place")}</Button>
        }
      />
    );
  return (
    <div className="space-y-3">
      {data.map((ad) => (
        <MyAdItem key={ad.id} ad={ad} today={today} onEdit={() => setEdit(ad)} onImage={() => setPic(ad)} />
      ))}
      <LinkSheet ad={edit} today={today} onClose={() => setEdit(null)} />
      <ImageSheet ad={pic} onClose={() => setPic(null)} />
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
        <b>{views}</b>{t("ad.stat.views")}</span>
      <span>
        <b>{s.open ?? 0}</b>{t("ad.stat.opens")}</span>
      <span>
        <b>{clicks}</b>{t("ad.stat.clicks")}</span>
      <span>
        <b>{views ? `${((clicks / views) * 100).toFixed(1)}%` : "—"}</b>CTR
      </span>
    </div>
  );
}

function MyAdItem({ ad, today, onEdit, onImage }: { ad: CityAdMine; today: string; onEdit: () => void; onImage: () => void }) {
  const st = statusView(ad, today);
  const pic = useAuthImage(ad.image_url).url;
  const canPic = ad.format === "facade_screen" && canEditLink(ad, today);
  const cancel = useCityAdCancel();
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closed = ["rejected", "cancelled", "expired"].includes(ad.status);
  const street = streetLink(ad, today);
  return (
    <Panel className={`cab-ad space-y-3 p-3${closed ? " closed" : ""}`} style={adVars(ad.color)}>
      <div className="cab-ad-head">
        <PlaceScene
          district={ad.district ?? districtOfSpot(ad.spot)}
          spot={ad.spot}
          zoom={ad.format === "line" ? 2.6 : 3}
          aspect={1.5}
          sign={{ spot: ad.spot, format: ad.format, ad: { title: ad.title, subtitle: ad.subtitle, color: ad.color, image: pic } }}
          className="cab-thumb"
          label={t("ad.signAria", { title: ad.title })}
        />
        <div className="min-w-0 flex-1">
          <Tag tone={st.tone}>{st.label}</Tag>
          <p className="cab-ad-t">{ad.title}</p>
          <p className="cab-ad-s">
            {spotName(ad.spot, ad.spot_title, ad.district)} · {fmtRange(ad.start, ad.end)} · {daysWord(ad.days)}
          </p>
        </div>
      </div>
      {ad.moderation_note && (ad.status === "rejected" || ad.status === "pending") && (
        <p className="cab-reason">
          <span>{ad.status === "rejected" ? t("ad.reason") : t("ad.comment")}</span>
          {ad.moderation_note}
        </p>
      )}
      {(ad.status === "approved" || ad.status === "expired" || (ad.stats && (ad.stats.impression ?? 0) > 0)) && <AdStats ad={ad} />}
      <div className="cab-ad-money">
        <span>{t("ad.paid")}{" "}<b>{ad.paid} TON</b>
        </span>
        {ad.refunded_nano > 0 && (
          <span>{t("ad.refunded")}{" "}<b>{ad.refunded} TON</b>
          </span>
        )}
        {ad.link_url && <span className="cab-ad-link">{linkHost(ad.link_url)}</span>}
      </div>
      {err && <p className="ui-fhint err">{err}</p>}
      {ask ? (
        <div className="cab-ask" role="alertdialog" aria-label={t("ad.cancelAria")}>
          <p>{t("ad.cancelAsk")}{" "}<b>{ton(ad.paid_nano - ad.refunded_nano)}</b>{" "}{t("ad.cancelAsk2")}</p>
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
                  setErr(e instanceof Error ? e.message : t("ad.cancelFail"));
                }
                setAsk(false);
              }}
            >{t("ad.cancelRefund")}</Button>
            <Button kind="secondary" size="sm" onClick={() => setAsk(false)}>{t("ad.keep")}</Button>
          </div>
        </div>
      ) : (
        (canCancel(ad) || canEditLink(ad, today) || street || canPic) && (
          <div className="cab-ad-act">
            {street && (
              <Link to={street} className="ui-btn secondary sm no-underline">{t("ad.onStreet")}</Link>
            )}
            {canEditLink(ad, today) && (
              <Button kind="secondary" size="sm" onClick={onEdit}>{t("ad.editLink")}</Button>
            )}
            {canPic && (
              <Button kind="secondary" size="sm" onClick={onImage}>
                {ad.image_url ? t("ad.replaceImage") : t("ad.addImage")}
              </Button>
            )}
            {canCancel(ad) && (
              <Button kind="ghost" size="sm" onClick={() => setAsk(true)}>{t("ad.cancelBtn")}</Button>
            )}
          </div>
        )
      )}
    </Panel>
  );
}

function LinkSheet({ ad, today, onClose }: { ad: CityAdMine | null; today: string; onClose: () => void }) {
  return (
    <Sheet open={!!ad} onClose={onClose} title={t("ad.adLink")} sub={ad ? quote(ad.title) : undefined}>
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
          <span>{t("ad.reReview1")}{" "}<b>{t("ad.reReview2")}</b>{" "}{t("ad.reReview3")}</span>
        </div>
      )}
      <Field label={t("ad.newLink")} error={hint ?? err} hint={t("ad.newLinkHint")}>
        <input
          className="ui-input"
          value={v}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("ad.linkPlaceholder")}
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
            setErr(e instanceof Error ? e.message : t("ad.saveFail"));
          }
        }}
      >
        {ad.status === "approved" ? t("ad.saveReview") : t("ad.save")}
      </Button>
    </div>
  );
}

function ImageSheet({ ad, onClose }: { ad: CityAdMine | null; onClose: () => void }) {
  return (
    <Sheet open={!!ad} onClose={onClose} title={t("ad.pic.label")} sub={ad ? quote(ad.title) : undefined}>
      {ad && <ImageForm key={ad.id} ad={ad} onDone={onClose} />}
    </Sheet>
  );
}

/** Заменить или убрать картинку экрана: новая картинка — снова на проверку (как смена ссылки), убрать — без проверки. */
function ImageForm({ ad, onDone }: { ad: CityAdMine; onDone: () => void }) {
  const [next, setNext] = useState<FacadePick | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useCityAdSetImage();
  const run = async (image_id: number | null) => {
    setErr(null);
    try {
      await save.mutateAsync({ id: ad.id, image_id });
      haptic.collect();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ad.saveFail"));
    }
  };
  return (
    <div className="space-y-3 pb-2">
      {ad.status === "approved" && (
        <div className="cab-warn amber" role="note">
          <span>{t("ad.reReviewPic1")}{" "}<b>{t("ad.reReview2")}</b>{" "}{t("ad.reReview3")}</span>
        </div>
      )}
      <FacadeImagePicker
        value={next}
        onChange={setNext}
        label={ad.image_url ? t("ad.newImage") : t("ad.pic.label")}
        note={t("ad.newImageNote")}
      />
      {err && <p className="ui-fhint err">{err}</p>}
      <Button block size="lg" disabled={!next || save.isPending} onClick={() => next && run(next.id)}>
        {ad.status === "approved" ? t("ad.saveReview") : t("ad.save")}
      </Button>
      {ad.image_url && (
        <Button block kind="ghost" size="sm" disabled={save.isPending} onClick={() => run(null)}>{t("ad.removeImage")}</Button>
      )}
    </div>
  );
}
