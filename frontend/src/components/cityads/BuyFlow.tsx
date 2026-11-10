import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
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
import { type SceneSlot } from "./AdScene";
import { PlaceScene } from "./DistrictAdScene";

/**
 * Покупка рекламы в городе: район и место → даты → текст → проверка и оплата с баланса.
 * Районы (PR 6): Центр, «Неон-ряды», «Порт» — по четыре-пять мест; цена — по типу места, экран на фасаде — только текст.
 * Цена, занятые сутки и проверка текста — живой расчёт сервера (POST /city-ads/quote); бронь — POST /city-ads.
 */
export type Step = 0 | 1 | 2 | 3;
const STEPS = ["Место", "Даты", "Текст", "Оплата"] as const;
const SAMPLE: Record<CityAdFormat, { title: string; subtitle?: string }> = {
  line: { title: "ВАША РЕКЛАМА НА БАШНЕ" },
  banner: { title: "ВАШ БРЕНД", subtitle: "здесь подпись" },
  neon: { title: "ВЫВЕСКА" },
  facade_screen: { title: "ВАШ ЭКРАН НА РЫНКЕ", subtitle: "подпись под заголовком" },
};
const DURATIONS = [1, 3, 7, 14, 30];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(id);
  }, [v, ms]);
  return d;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Не удалось связаться с сервером");
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
  const [confirm, setConfirm] = useState(false);
  const [fail, setFail] = useState<BookFail | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // ── живой расчёт: даты и цена ──
  const datesBody: CityAdQuoteIn | null = spotKey ? { spot: spotKey, start, days, district } : null;
  const sub = hasSubtitle(fmt);
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
  const sample = fmt === "line" && district !== "centre" ? "ВАША РЕКЛАМА ЗДЕСЬ" : SAMPLE[fmt].title;
  const sign = spot
    ? {
        spot: spot.key,
        format: fmt,
        ad: {
          title: title.trim() || sample,
          subtitle: sub ? subtitle.trim() || (title.trim() ? "" : SAMPLE[fmt].subtitle) : null,
          color,
        },
      }
    : null;

  return (
    <div ref={top} className="cab-flow space-y-3">
      <ol className="cab-steps" aria-label="Шаги покупки">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "on" : i < step ? "done" : undefined}>
            <button type="button" disabled={i > step} aria-current={i === step ? "step" : undefined} onClick={() => i < step && go(i as Step)}>
              <b>{i + 1}</b>
              {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <SpotStep board={board} district={district} onDistrict={onDistrict} spotKey={spotKey} onPick={setSpotKey} sign={sign} />
      )}

      {step === 1 && !quote && <Panel className="cab-step p-4"><p className="cab-note">Считаем свободные даты…</p></Panel>}
      {step === 1 && quote && (
        <Panel className="cab-step space-y-4 p-4" key="dates">
          <div>
            <p className="ui-label">Начало показа</p>
            <p className="cab-note">С завтрашнего дня (МСК), не позже чем через 90 дней. Сутки идут по Москве.</p>
          </div>
          <AdCalendar start={start} days={days} earliest={quote.earliest} latest={quote.latest} busy={quote.busy} onPick={setStart} />
          <div className="space-y-2">
            <p className="ui-label">Срок</p>
            <div className="cab-dur">
              <button type="button" className="cab-stepper" aria-label="Меньше суток" disabled={days <= minDays} onClick={() => setDays(days - 1)}>
                −
              </button>
              <output className="cab-dur-v" aria-live="polite">
                {daysWord(days)}
              </output>
              <button type="button" className="cab-stepper" aria-label="Больше суток" disabled={days >= maxDays} onClick={() => setDays(days + 1)}>
                +
              </button>
            </div>
            <div className="cab-chips" role="group" aria-label="Быстрый выбор срока">
              {DURATIONS.filter((d) => d >= minDays && d <= maxDays).map((d) => (
                <button key={d} type="button" className={d === days ? "on" : undefined} aria-pressed={d === days} onClick={() => setDays(d)}>
                  {d} сут.
                </button>
              ))}
            </div>
          </div>
          <div className={`cab-range${quote.available ? "" : " bad"}`} role="status">
            <span>
              Показ <b>{fmtRange(quote.start, quote.end)}</b> · {daysWord(quote.days)}
            </span>
            {!quote.available && (
              <span className="cab-range-warn">
                {quote.occupied.length} {quote.occupied.length === 1 ? "сутки уже заняты" : "суток уже заняты"}.{" "}
                {quote.next_free ? (
                  <button type="button" onClick={() => setStart(quote.next_free!)}>
                    Ближайшее свободное — с {fmtDay(quote.next_free)}
                  </button>
                ) : (
                  "Свободного окна такой длины нет — сократите срок."
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
              className="cab-mini"
              label="Так вывеска будет выглядеть в городе"
            />
          )}
          <Panel className="cab-step space-y-4 p-4">
            <Field
              label={fmt === "line" ? "Текст бегущей строки" : fmt === "facade_screen" ? "Заголовок на экране" : "Надпись на вывеске"}
              unit={<Count n={title.length} max={lim.title_max} />}
              error={fieldErr("title")}
              hint={
                fmt === "line"
                  ? district === "centre"
                    ? "Проезжает по башне между показами «МАЙНЕР»"
                    : "Проезжает по строке раз за разом"
                  : fmt === "facade_screen"
                    ? "Экран — только текст: заголовок и подпись. Картинки — позже"
                    : "Коротко и крупно — её читают на ходу"
              }
            >
              <input className="ui-input" value={title} maxLength={lim.title_max} placeholder={sample} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {sub && (
              <Field
                label={fmt === "facade_screen" ? "Подпись на экране" : "Подпись под надписью"}
                unit={<Count n={subtitle.length} max={lim.subtitle_max ?? 18} />}
                error={fieldErr("subtitle")}
                hint="Необязательно"
              >
                <input className="ui-input" value={subtitle} maxLength={lim.subtitle_max ?? 18} placeholder="например, «скидка 20 %»" onChange={(e) => setSubtitle(e.target.value)} />
              </Field>
            )}
            <Field label="Текст карточки" unit={<Count n={body.length} max={bodyMax} />} error={fieldErr("body")} hint="Открывается по касанию вывески в «Прогулке». Необязательно">
              <textarea className="ui-input cab-ta" value={body} maxLength={bodyMax} rows={3} placeholder="Что вы предлагаете и почему стоит перейти" onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="space-y-2">
              <p className="ui-flabel">Цвет</p>
              <div className="cab-palette" role="radiogroup" aria-label="Цвет вывески">
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
              label="Ссылка"
              error={fieldErr("link")}
              hint={
                normLink && settled && !serverErr ? (
                  <span className="cab-ok">
                    ✓ {linkKind === "telegram" ? "Откроется в Telegram" : "Откроется во внешнем браузере"}: {normLink}
                  </span>
                ) : (
                  "Только https:// или t.me/… · без сокращателей (bit.ly и т. п.) · необязательно"
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
                placeholder="https://… или t.me/канал"
                onChange={(e) => setLink(e.target.value)}
              />
            </Field>
            {serverErr && settled && !errField && <p className="ui-fhint err">{serverErr}</p>}
            {cq.isError && !serverErr && <p className="ui-fhint err">Не удалось проверить текст — проверьте связь</p>}
          </Panel>
        </div>
      )}

      {step === 3 && spot && quote && (
        <ReviewStep
          district={district}
          spot={spot}
          fmt={fmt}
          sign={sign}
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
          <span className="k">{quote ? `${daysWord(quote.days)} × ${ton(quote.price_day_nano)}` : spot?.price_day ? `${spot.price_day} TON / сутки` : "Цена"}</span>
          <b className={dq.isFetching ? "busy" : undefined}>{quote ? ton(quote.total_nano) : "—"}</b>
        </div>
        {step === 0 && (
          <Button size="lg" disabled={!spotKey} onClick={() => go(1)}>
            Выбрать даты
          </Button>
        )}
        {step === 1 && (
          <Button size="lg" disabled={!quote?.available || dq.isFetching} onClick={() => go(2)}>
            К тексту
          </Button>
        )}
        {step === 2 && (
          <Button size="lg" disabled={!contentOk || !settled} onClick={() => go(3)}>
            Проверить
          </Button>
        )}
        {step === 3 && (
          <Button size="lg" disabled={!quote?.available || short > 0 || book.isPending} onClick={() => setConfirm(true)}>
            Оплатить {quote ? ton(quote.total_nano) : ""}
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
        title="Оплата с баланса"
        sub={spot ? `${spotName(spot.key, spot.title, district)} · ${quote ? fmtRange(quote.start, quote.end) : ""}` : undefined}
        footer={
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button size="lg" onClick={pay} disabled={book.isPending} haptics="heavy">
              {book.isPending ? "Оплата…" : `Списать ${quote ? ton(quote.total_nano) : ""}`}
            </Button>
            <Button kind="secondary" size="lg" onClick={() => setConfirm(false)}>
              Отмена
            </Button>
          </div>
        }
      >
        <div className="cab-confirm space-y-3">
          <div className="cab-rows">
            <Row k="Спишется" v={quote ? ton(quote.total_nano) : "—"} strong />
            <Row k="Баланс после" v={ton(Math.max(0, balance - total))} />
          </div>
          <p className="cab-note">
            Объявление уйдёт на проверку. Если его не одобрят — TON вернутся на баланс полностью. Передумали — отмена до проверки, тоже с полным возвратом.
          </p>
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
  sign: { spot: string; format: CityAdFormat; ad: { title: string; subtitle?: string | null; color: string } } | null;
}) {
  const spots = board.spots;
  const none = !spots.some((s) => s.on_sale);
  const slots: SceneSlot[] = spots.map((s, i) => ({
    key: s.key,
    n: i + 1,
    state: !s.on_sale ? "off" : s.key === spotKey ? "picked" : "free",
    label: `${i + 1}. ${s.title}`,
  }));
  return (
    <div className="space-y-3" key="spot">
      {onDistrict && (
        <div className="cab-district" role="radiogroup" aria-label="Район">
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
        label={`Места для рекламы: ${AD_DISTRICT_RU[district]}`}
      />
      {none && <p className="cab-note">Сейчас в этом районе нет мест в продаже — выберите другой район.</p>}
      <div className="cab-spots" role="radiogroup" aria-label="Место">
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
        <span className="t">{s.title}</span>
        <span className="s">
          {FORMAT_RU[s.format] ?? s.format}
          {s.ad ? ` · сейчас занято до ${fmtDay(s.ad.until)}` : ""}
        </span>
      </span>
      <span className="p">{s.on_sale ? <>{s.price_day} TON<small>/сутки</small></> : <small>не продаётся</small>}</span>
    </button>
  );
}

function ReviewStep({
  district,
  spot,
  fmt,
  sign,
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
  sign: { spot: string; format: CityAdFormat; ad: { title: string; subtitle?: string | null; color: string } } | null;
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
  const [night, setNight] = useState(true);
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
            label="Превью вывески в городе"
          >
            <div className="cab-daynight" role="group" aria-label="Время суток превью">
              <button type="button" aria-pressed={night} className={night ? "on" : undefined} onClick={() => setNight(true)}>
                Ночью
              </button>
              <button type="button" aria-pressed={!night} className={!night ? "on" : undefined} onClick={() => setNight(false)}>
                Днём
              </button>
            </div>
          </PlaceScene>
        )}
      </div>
      <AdCardPreview format={fmt} title={title} subtitle={subtitle} body={body} link={link} linkKind={linkKind} color={color} days={quote.days} />
      {fail && <FailPanel fail={fail} onDates={onDates} />}
      <Panel className="space-y-1 p-4">
        <div className="cab-rows">
          <Row k="Место" v={spotName(spot.key, spot.title, district)} />
          <Row k="Показ" v={`${fmtRange(quote.start, quote.end)} · ${daysWord(quote.days)}`} />
          <Row k="Цена за сутки" v={ton(quote.price_day_nano)} />
          <Row k="Итого" v={ton(quote.total_nano)} strong />
          <Row k="Ваш баланс" v={ton(balance)} />
        </div>
        {short > 0 && (
          <div className="cab-warn" role="alert">
            <span>
              Не хватает <b>{ton(short)}</b>
            </span>
            <Link to="/wallet" className="ui-btn secondary sm no-underline">
              Пополнить
            </Link>
          </div>
        )}
        <p className="cab-note pt-2">
          <Tag tone="amber" dot={false}>
            Проверка
          </Tag>{" "}
          Владелец проверяет каждое объявление. До одобрения его не видно в городе.
        </p>
      </Panel>
    </div>
  );
}

function FailPanel({ fail, onDates }: { fail: BookFail; onDates: () => void }) {
  if (fail.kind === "busy")
    return (
      <Panel danger className="cab-fail space-y-2 p-4" role="alert">
        <p className="ui-h">Эти сутки только что заняли</p>
        <p className="cab-note">Кто-то оплатил это место раньше. Деньги не списаны — выберите другие даты.</p>
        <Button kind="secondary" size="sm" onClick={onDates}>
          Выбрать даты
        </Button>
      </Panel>
    );
  if (fail.kind === "funds")
    return (
      <Panel danger className="cab-fail space-y-2 p-4" role="alert">
        <p className="ui-h">Не хватает TON</p>
        <p className="cab-note">{fail.text}. Ничего не списано.</p>
        <Link to="/wallet" className="ui-btn secondary sm self-start no-underline">
          Пополнить баланс
        </Link>
      </Panel>
    );
  return (
    <Panel danger className="cab-fail space-y-2 p-4" role="alert">
      <p className="ui-h">Не получилось оплатить</p>
      <p className="cab-note">{fail.text}</p>
    </Panel>
  );
}
