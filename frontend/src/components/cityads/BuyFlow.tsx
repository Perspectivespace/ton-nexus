import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAuthImage,
  useCityAdBook,
  useCityAdQuote,
  type CityAdFormat,
  type CityAdQuoteIn,
  type CityAdsBoard,
  type CityAdSpotOnBoard,
} from "@/api/hooks";
import { ApiError } from "@/api/client";
import type { MeOut } from "@/api/types";
import { Button, Field, Panel, Sheet, Tag } from "@/components/ui";
import { AD_PALETTE, adVars } from "@/lib/cityAdPalette";
import { haptic } from "@/lib/haptics";
import {
  COLOR_RU,
  AD_DISTRICTS,
  AD_DISTRICT_RU,
  FORMAT_RU,
  spotTitle,
  addDays,
  contentField,
  daysWord,
  fmtDay,
  fmtRange,
  hasSubtitle,
  linkHint,
  spotName,
  ton,
  tonToNano,
  type AdDistrict,
  type ContentField,
} from "@/lib/cityAdBuy";
import { AdCalendar } from "./AdCalendar";
import { AdCardPreview } from "./AdCardPreview";
import { FacadeImagePicker, type FacadePick } from "./FacadeImage";
import { type SceneSlot } from "./AdScene";
import { PlaceScene, type PlaceSign } from "./DistrictAdScene";
import { t, tp } from "@/i18n";

/**
 * Покупка рекламы в городе: район и место → даты → текст → проверка и оплата с баланса.
 * Районы (PR 6): Центр, «Неон-ряды», «Порт» — по четыре-пять мест; цена — по типу места.
 * Экран на фасаде «Неон-рядов» — заголовок, подпись и (по желанию) картинка: сервер пережимает её, превью — на рисунке
 * района днём и ночью; картинка уходит на проверку вместе с текстом (POST /city-ads/images → image_id в брони).
 * Цена, занятые сутки и проверка текста — живой расчёт сервера (POST /city-ads/quote); бронь — POST /city-ads.
 */
export type Step = 0 | 1 | 2 | 3;
const STEPS = ["ad.step.spot", "ad.step.dates", "ad.step.text", "ad.step.pay"] as const;
/** образец текста на превью — на языке игрока, читается в момент показа */
const sampleOf = (f: CityAdFormat): { title: string; subtitle?: string } =>
  f === "line"
    ? { title: t("ad.sample.line") }
    : f === "banner"
      ? { title: t("ad.sample.banner"), subtitle: t("ad.sample.bannerSub") }
      : f === "neon"
        ? { title: t("ad.sample.neon") }
        : { title: t("ad.sample.facade"), subtitle: t("ad.sample.facadeSub") };
const DURATIONS = [1, 3, 7, 14, 30];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(id);
  }, [v, ms]);
  return d;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : t("ad.netFail"));
const errStatus = (e: unknown) => (e instanceof ApiError ? e.status : 0);

type BookFail = { kind: "busy" | "funds" | "other"; text: string };

export function BuyFlow({
  board,
  me,
  district = "centre",
  initialSpot,
  onDistrict,
  onLocked,
  onDone,
}: {
  board: CityAdsBoard;
  me: MeOut;
  district?: AdDistrict;
  initialSpot?: string | null;
  onDistrict?: (d: AdDistrict) => void;
  onLocked: () => void;
  onDone: () => void;
}) {
  const sale = board.spots.filter((s) => s.on_sale);
  const tomorrow = addDays(board.day, 1);
  const minDays = board.min_days ?? 1;
  const maxDays = board.max_days ?? 30;
  const [step, setStep] = useState<Step>(0);
  const [spotKey, setSpotKey] = useState<string | null>(
    (initialSpot && sale.some((s) => s.key === initialSpot) ? initialSpot : null) ?? sale[0]?.key ?? null,
  );
  const spot = board.spots.find((s) => s.key === spotKey) ?? null;
  const fmt: CityAdFormat = spot?.format ?? "banner";
  const lim = board.limits?.[fmt] ?? { title_max: 14, subtitle_max: 18 };
  const bodyMax = board.body_max ?? 500;
  const [start, setStart] = useState(tomorrow);
  const [days, setDays] = useState(Math.max(minDays, Math.min(7, maxDays)));
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [color, setColor] = useState("cyan");
  const [image, setImage] = useState<FacadePick | null>(null);
  const [night, setNight] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [fail, setFail] = useState<BookFail | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // ── живой расчёт: даты и цена ──
  const datesBody: CityAdQuoteIn | null = spotKey ? { spot: spotKey, start, days, district } : null;
  const sub = hasSubtitle(fmt);
  const canPic = fmt === "facade_screen" && board.image_upload !== false;
  const pic = useAuthImage(canPic ? image?.path : null).url;
  const dq = useCityAdQuote(datesBody);
  const quote = dq.data && dq.data.spot === spotKey ? dq.data : null;
  // сервер проверил уровень сам (данные /me могли устареть)
  useEffect(() => {
    if (errStatus(dq.error) === 403) onLocked();
  }, [dq.error, onLocked]);
  // первый расчёт для места: если завтра занято — сразу ближайшая свободная дата
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!quote || jumped.current === quote.spot || dq.isPlaceholderData) return;
    jumped.current = quote.spot;
    if (!quote.available && quote.next_free && quote.next_free !== start) setStart(quote.next_free);
  }, [quote, dq.isPlaceholderData, start]);

  // ── живой расчёт: проверка текста и ссылки (с задержкой, пока печатают) ──
  const content = useMemo(
    () => ({
      title: title.trim() || undefined,
      subtitle: sub ? subtitle.trim() || undefined : undefined,
      body: body.trim() || undefined,
      link_url: link.trim() || undefined,
      color,
    }),
    [title, subtitle, body, link, color, sub],
  );
  const contentDeb = useDebounced(content, 350);
  const cq = useCityAdQuote(step >= 2 && datesBody ? { ...datesBody, ...contentDeb } : null, "content");
  const settled = contentDeb === content && !cq.isFetching;
  const serverErr = cq.error && errStatus(cq.error) === 400 ? errText(cq.error) : null;
  const errField: ContentField | null = serverErr ? contentField(serverErr) : null;
  const hint = linkHint(link);
  const fieldErr = (f: ContentField): string | null => {
    if (f === "link" && hint) return hint;
    return errField === f && settled ? serverErr : null;
  };
  const normLink = cq.data?.content?.link_url ?? null;
  const linkKind = cq.data?.content?.link_kind ?? (/t(elegram)?\.me\//i.test(link) ? "telegram" : link ? "web" : null);

  const total = quote?.total_nano ?? 0;
  const balance = tonToNano(me.balance);
  const short = Math.max(0, total - balance);

  const go = (s: Step) => {
    setStep(s);
    setFail(null);
    top.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  const book = useCityAdBook();
  async function pay() {
    if (!spotKey || !quote) return;
    setFail(null);
    try {
      await book.mutateAsync({
        spot: spotKey,
        district,
        start,
        days,
        title: title.trim(),
        subtitle: sub ? subtitle.trim() || undefined : undefined,
        body: body.trim() || undefined,
        link_url: link.trim() || undefined,
        color,
        image_id: canPic && image ? image.id : undefined,
      });
      haptic.collect();
      setConfirm(false);
      onDone();
    } catch (e) {
      haptic.heavy();
      setConfirm(false);
      const st = errStatus(e);
      if (st === 403) return onLocked();
      setFail({ kind: st === 409 ? "busy" : st === 402 ? "funds" : "other", text: errText(e) });
      if (st === 409) void dq.refetch();
    }
  }

  const titleOk = title.trim().length > 0 && !fieldErr("title");
  const contentOk = titleOk && !hint && !(serverErr && settled) && !cq.isError;
  // образец строки: в Центре — «на башне», в районах — просто «здесь»
  const sample = fmt === "line" && district !== "centre" ? t("ad.sampleHere") : sampleOf(fmt).title;
  const sign = spot
    ? {
        spot: spot.key,
        format: fmt,
        ad: {
          title: title.trim() || sample,
          subtitle: sub ? subtitle.trim() || (title.trim() ? "" : sampleOf(fmt).subtitle) : null,
          color,
          image: canPic ? pic : null,
        },
      }
    : null;

  return (
    <div ref={top} className="cab-flow space-y-3">
      <ol className="cab-steps" aria-label={t("ad.stepsAria")}>
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "on" : i < step ? "done" : undefined}>
            <button type="button" disabled={i > step} aria-current={i === step ? "step" : undefined} onClick={() => i < step && go(i as Step)}>
              <b>{i + 1}</b>
              {t(s)}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <SpotStep board={board} district={district} onDistrict={onDistrict} spotKey={spotKey} onPick={setSpotKey} sign={sign} />
      )}

      {step === 1 && !quote && <Panel className="cab-step p-4"><p className="cab-note">{t("ad.countingDates")}</p></Panel>}
      {step === 1 && quote && (
        <Panel className="cab-step space-y-4 p-4" key="dates">
          <div>
            <p className="ui-label">{t("ad.start")}</p>
            <p className="cab-note">{t("ad.startHint")}</p>
          </div>
          <AdCalendar start={start} days={days} earliest={quote.earliest} latest={quote.latest} busy={quote.busy} onPick={setStart} />
          <div className="space-y-2">
            <p className="ui-label">{t("ad.duration")}</p>
            <div className="cab-dur">
              <button type="button" className="cab-stepper" aria-label={t("ad.lessDays")} disabled={days <= minDays} onClick={() => setDays(days - 1)}>
                −
              </button>
              <output className="cab-dur-v" aria-live="polite">
                {daysWord(days)}
              </output>
              <button type="button" className="cab-stepper" aria-label={t("ad.moreDays")} disabled={days >= maxDays} onClick={() => setDays(days + 1)}>
                +
              </button>
            </div>
            <div className="cab-chips" role="group" aria-label={t("ad.quickDuration")}>
              {DURATIONS.filter((d) => d >= minDays && d <= maxDays).map((d) => (
                <button key={d} type="button" className={d === days ? "on" : undefined} aria-pressed={d === days} onClick={() => setDays(d)}>
                  {t("ad.daysShort", { n: d })}
                </button>
              ))}
            </div>
          </div>
          <div className={`cab-range${quote.available ? "" : " bad"}`} role="status">
            <span>{t("ad.run")}{" "}<b>{fmtRange(quote.start, quote.end)}</b> · {daysWord(quote.days)}
            </span>
            {!quote.available && (
              <span className="cab-range-warn">
                {tp("ad.occupied", quote.occupied.length)}.{" "}
                {quote.next_free ? (
                  <button type="button" onClick={() => setStart(quote.next_free!)}>{t("ad.nextFree")}{" "}{fmtDay(quote.next_free)}
                  </button>
                ) : (
                  t("ad.noWindow")
                )}
              </span>
            )}
          </div>
        </Panel>
      )}

      {step === 2 && spot && (
        <div className="space-y-3" key="content">
          {sign && (
            <PlaceScene
              district={district}
              spot={spot.key}
              zoom={fmt === "line" ? 2.4 : 2.6}
              aspect={2}
              sign={sign}
              phase={canPic ? (night ? "night" : "day") : undefined}
              className="cab-mini"
              label={t("ad.signPreviewHint")}
            >
              {canPic && <DayNight night={night} onNight={setNight} />}
            </PlaceScene>
          )}
          <Panel className="cab-step space-y-4 p-4">
            <Field
              label={fmt === "line" ? t("ad.lineText") : fmt === "facade_screen" ? t("ad.screenTitle") : t("ad.signText")}
              unit={<Count n={title.length} max={lim.title_max} />}
              error={fieldErr("title")}
              hint={
                fmt === "line"
                  ? district === "centre"
                    ? t("ad.lineHintTower")
                    : t("ad.lineHint")
                  : fmt === "facade_screen"
                    ? canPic
                      ? t("ad.screenHintPic")
                      : t("ad.screenHint")
                    : t("ad.signHint")
              }
            >
              <input className="ui-input" value={title} maxLength={lim.title_max} placeholder={sample} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {sub && (
              <Field
                label={fmt === "facade_screen" ? t("ad.screenSub") : t("ad.signSub")}
                unit={<Count n={subtitle.length} max={lim.subtitle_max ?? 18} />}
                error={fieldErr("subtitle")}
                hint={t("ad.optional")}
              >
                <input className="ui-input" value={subtitle} maxLength={lim.subtitle_max ?? 18} placeholder={t("ad.subPlaceholder")} onChange={(e) => setSubtitle(e.target.value)} />
              </Field>
            )}
            {canPic && <FacadeImagePicker value={image} onChange={setImage} />}
            <Field label={t("ad.cardText")} unit={<Count n={body.length} max={bodyMax} />} error={fieldErr("body")} hint={t("ad.cardTextHint")}>
              <textarea className="ui-input cab-ta" value={body} maxLength={bodyMax} rows={3} placeholder={t("ad.cardTextPlaceholder")} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="space-y-2">
              <p className="ui-flabel">{t("ad.color")}</p>
              <div className="cab-palette" role="radiogroup" aria-label={t("ad.signColor")}>
                {Object.keys(AD_PALETTE).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === color}
                    aria-label={COLOR_RU[c] ?? c}
                    className={c === color ? "on" : undefined}
                    style={adVars(c)}
                    onClick={() => {
                      haptic.select();
                      setColor(c);
                    }}
                  >
                    <i />
                    <span>{COLOR_RU[c] ?? c}</span>
                  </button>
                ))}
              </div>
              {fieldErr("color") && <p className="ui-fhint err">{fieldErr("color")}</p>}
            </div>
            <Field
              label={t("ad.link")}
              error={fieldErr("link")}
              hint={
                normLink && settled && !serverErr ? (
                  <span className="cab-ok">
                    ✓ {linkKind === "telegram" ? t("ad.opensTg") : t("ad.opensBrowser")}: {normLink}
                  </span>
                ) : (
                  t("ad.linkHint")
                )
              }
            >
              <input
                className="ui-input"
                value={link}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("ad.linkPlaceholder")}
                onChange={(e) => setLink(e.target.value)}
              />
            </Field>
            {serverErr && settled && !errField && <p className="ui-fhint err">{serverErr}</p>}
            {cq.isError && !serverErr && <p className="ui-fhint err">{t("ad.checkFail")}</p>}
          </Panel>
        </div>
      )}

      {step === 3 && spot && quote && (
        <ReviewStep
          district={district}
          spot={spot}
          fmt={fmt}
          sign={sign}
          night={night}
          onNight={setNight}
          hasImage={canPic && !!image}
          title={title.trim()}
          subtitle={sub ? subtitle.trim() : ""}
          body={body.trim()}
          link={normLink ?? (link.trim() || null)}
          linkKind={linkKind}
          color={color}
          quote={quote}
          balance={balance}
          short={short}
          fail={fail}
          onDates={() => go(1)}
        />
      )}

      {/* низ шага: цена и «Далее» */}
      <Panel level="e2" className="cab-bar p-3" lift="l2">
        <div className="cab-sum">
          <span className="k">{quote ? `${daysWord(quote.days)} × ${ton(quote.price_day_nano)}` : spot?.price_day ? t("ad.pricePerDay", { priceDay: spot.price_day }) : t("ad.price")}</span>
          <b className={dq.isFetching ? "busy" : undefined}>{quote ? ton(quote.total_nano) : "—"}</b>
        </div>
        {step === 0 && (
          <Button size="lg" disabled={!spotKey} onClick={() => go(1)}>{t("ad.pickDates")}</Button>
        )}
        {step === 1 && (
          <Button size="lg" disabled={!quote?.available || dq.isFetching} onClick={() => go(2)}>{t("ad.toText")}</Button>
        )}
        {step === 2 && (
          <Button size="lg" disabled={!contentOk || !settled} onClick={() => go(3)}>{t("ad.check")}</Button>
        )}
        {step === 3 && (
          <Button size="lg" disabled={!quote?.available || short > 0 || book.isPending} onClick={() => setConfirm(true)}>{t("ad.pay")}{" "}{quote ? ton(quote.total_nano) : ""}
          </Button>
        )}
      </Panel>
      {dq.isError && errStatus(dq.error) !== 403 && (
        <p className="ui-fhint err" role="alert">
          {errText(dq.error)}
        </p>
      )}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("ad.payFromBalance")}
        sub={spot ? `${spotName(spot.key, spot.title, district)} · ${quote ? fmtRange(quote.start, quote.end) : ""}` : undefined}
        footer={
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button size="lg" onClick={pay} disabled={book.isPending} haptics="heavy">
              {book.isPending ? t("ad.paying") : t("ad.charge", { totalNano: quote ? ton(quote.total_nano) : "" })}
            </Button>
            <Button kind="secondary" size="lg" onClick={() => setConfirm(false)}>{t("ui.cancel")}</Button>
          </div>
        }
      >
        <div className="cab-confirm space-y-3">
          <div className="cab-rows">
            <Row k={t("ad.willCharge")} v={quote ? ton(quote.total_nano) : "—"} strong />
            <Row k={t("ad.balanceAfter")} v={ton(Math.max(0, balance - total))} />
          </div>
          <p className="cab-note">{t("ad.payNote")}</p>
        </div>
      </Sheet>
    </div>
  );
}

function Count({ n, max }: { n: number; max: number }) {
  return <span className={`cab-count${n >= max ? " full" : ""}`}>{`${n}/${max}`}</span>;
}

export function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`cab-row${strong ? " strong" : ""}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function SpotStep({
  board,
  district,
  onDistrict,
  spotKey,
  onPick,
  sign,
}: {
  board: CityAdsBoard;
  district: AdDistrict;
  onDistrict?: (d: AdDistrict) => void;
  spotKey: string | null;
  onPick: (k: string) => void;
  sign: PlaceSign | null;
}) {
  const spots = board.spots;
  const none = !spots.some((s) => s.on_sale);
  const slots: SceneSlot[] = spots.map((s, i) => ({
    key: s.key,
    n: i + 1,
    state: !s.on_sale ? "off" : s.key === spotKey ? "picked" : "free",
    label: `${i + 1}. ${spotTitle(s.key, s.title)}`,
  }));
  return (
    <div className="space-y-3" key="spot">
      {onDistrict && (
        <div className="cab-district" role="radiogroup" aria-label={t("city.district")}>
          {AD_DISTRICTS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === district}
              className={d === district ? "on" : undefined}
              onClick={() => {
                if (d === district) return;
                haptic.select();
                onDistrict(d);
              }}
            >
              {AD_DISTRICT_RU[d]}
            </button>
          ))}
        </div>
      )}
      <PlaceScene
        key={district}
        district={district}
        slots={slots}
        onPick={(k) => (haptic.select(), onPick(k))}
        sign={sign}
        label={t("ad.spotsAria", { district: AD_DISTRICT_RU[district] })}
      />
      {none && <p className="cab-note">{t("ad.noSpots")}</p>}
      <div className="cab-spots" role="radiogroup" aria-label={t("ad.spot")}>
        {spots.map((s, i) => (
          <SpotRow key={s.key} s={s} n={i + 1} on={s.key === spotKey} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function SpotRow({ s, n, on, onPick }: { s: CityAdSpotOnBoard; n: number; on: boolean; onPick: (k: string) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={!s.on_sale}
      className={`cab-spot${on ? " on" : ""}`}
      onClick={() => {
        haptic.select();
        onPick(s.key);
      }}
    >
      <b className="n">{n}</b>
      <span className="m">
        <span className="t">{spotTitle(s.key, s.title)}</span>
        <span className="s">
          {FORMAT_RU[s.format] ?? s.format}
          {s.ad ? t("ad.takenUntil", { until: fmtDay(s.ad.until) }) : ""}
        </span>
      </span>
      <span className="p">{s.on_sale ? <>{s.price_day} TON<small>{t("ad.perDay")}</small></> : <small>{t("ad.notForSale")}</small>}</span>
    </button>
  );
}

function ReviewStep({
  district,
  spot,
  fmt,
  sign,
  night,
  onNight,
  hasImage,
  title,
  subtitle,
  body,
  link,
  linkKind,
  color,
  quote,
  balance,
  short,
  fail,
  onDates,
}: {
  district: AdDistrict;
  spot: CityAdSpotOnBoard;
  fmt: CityAdFormat;
  sign: PlaceSign | null;
  night: boolean;
  onNight: (v: boolean) => void;
  hasImage: boolean;
  title: string;
  subtitle: string;
  body: string;
  link: string | null;
  linkKind: "telegram" | "web" | null;
  color: string;
  quote: NonNullable<ReturnType<typeof useCityAdQuote>["data"]>;
  balance: number;
  short: number;
  fail: BookFail | null;
  onDates: () => void;
}) {
  return (
    <div className="space-y-3" key="review">
      <div className="cab-prev">
        {sign && (
          <PlaceScene
            district={district}
            spot={spot.key}
            zoom={fmt === "line" ? 2.4 : 2.2}
            aspect={1.7}
            phase={night ? "night" : "day"}
            sign={sign}
            label={t("ad.signPreviewAria")}
          >
            <DayNight night={night} onNight={onNight} />
          </PlaceScene>
        )}
      </div>
      <AdCardPreview format={fmt} title={title} subtitle={subtitle} body={body} link={link} linkKind={linkKind} color={color} days={quote.days} />
      {fail && <FailPanel fail={fail} onDates={onDates} />}
      <Panel className="space-y-1 p-4">
        <div className="cab-rows">
          <Row k={t("ad.spot")} v={spotName(spot.key, spot.title, district)} />
          {fmt === "facade_screen" && <Row k={t("ad.image")} v={hasImage ? t("ad.imageYes") : t("ad.imageNo")} />}
          <Row k={t("ad.run")} v={`${fmtRange(quote.start, quote.end)} · ${daysWord(quote.days)}`} />
          <Row k={t("ad.pricePerDayLabel")} v={ton(quote.price_day_nano)} />
          <Row k={t("ad.total")} v={ton(quote.total_nano)} strong />
          <Row k={t("ad.yourBalance")} v={ton(balance)} />
        </div>
        {short > 0 && (
          <div className="cab-warn" role="alert">
            <span>{t("ad.short")}{" "}<b>{ton(short)}</b>
            </span>
            <Link to="/wallet" className="ui-btn secondary sm no-underline">{t("ad.topUp")}</Link>
          </div>
        )}
        <p className="cab-note pt-2">
          <Tag tone="amber" dot={false}>{t("ad.review")}</Tag>{" "}{t("ad.reviewNote")}</p>
      </Panel>
    </div>
  );
}

function DayNight({ night, onNight }: { night: boolean; onNight: (v: boolean) => void }) {
  return (
    <div className="cab-daynight" role="group" aria-label={t("ad.previewTime")}>
      <button type="button" aria-pressed={night} className={night ? "on" : undefined} onClick={() => onNight(true)}>{t("ad.night")}</button>
      <button type="button" aria-pressed={!night} className={!night ? "on" : undefined} onClick={() => onNight(false)}>{t("ad.day")}</button>
    </div>
  );
}

function FailPanel({ fail, onDates }: { fail: BookFail; onDates: () => void }) {
  if (fail.kind === "busy")
    return (
      <Panel danger className="cab-fail space-y-2 p-4" role="alert">
        <p className="ui-h">{t("ad.justTaken")}</p>
        <p className="cab-note">{t("ad.justTakenNote")}</p>
        <Button kind="secondary" size="sm" onClick={onDates}>{t("ad.pickDates")}</Button>
      </Panel>
    );
  if (fail.kind === "funds")
    return (
      <Panel danger className="cab-fail space-y-2 p-4" role="alert">
        <p className="ui-h">{t("ad.notEnoughTon")}</p>
        <p className="cab-note">{fail.text}{t("ad.nothingCharged")}</p>
        <Link to="/wallet" className="ui-btn secondary sm self-start no-underline">{t("ad.topUpBalance")}</Link>
      </Panel>
    );
  return (
    <Panel danger className="cab-fail space-y-2 p-4" role="alert">
      <p className="ui-h">{t("ad.payFail")}</p>
      <p className="cab-note">{fail.text}</p>
    </Panel>
  );
}
