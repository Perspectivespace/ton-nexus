import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useMe, useSetLang, useMyWithdrawals, useWithdrawLimits, useWallet, useWalletUnlink, useDepositInfo, useRecentHistory } from "@/api/hooks";
import { useQueryClient } from "@tanstack/react-query";
import type { MeOut } from "@/api/types";
import { WorkArea } from "@/components/WorkArea";
import { ProfileRanks } from "@/components/RatingLinks";
import { api } from "@/api/client";
import { IconGear, IconHistory, IconOut, IconWallet } from "@/components/icons";
import { WalletConnectSheet } from "@/components/WalletConnectSheet";
import { TopUpSheet } from "@/components/TopUpSheet";
import { BalanceHistorySheet, HistoryRow } from "@/components/BalanceHistory";
import { LazyTonConnectProvider } from "@/lib/tonconnect";
import { prefersReducedMotion } from "@/components/ui/press";
import { Button, Field, HoldButton, List, ListRow, Num, Panel, ScreenHeader, SectionLabel, Sheet, Tabs, Tag, useToast } from "@/components/ui";
import { LANGS, LANG_NAMES, fmtDate, fmtNum, t, type Lang, useLangStore } from "@/i18n";

/** Тот же формат, что проверяет сервер */
const TON_ADDR = /^(UQ|EQ)[A-Za-z0-9_-]{46}$/;

function shortAddr(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}

function whenLabel(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : fmtDate(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Метка уровня в шапке «Профиля»: «ур. 7 · 1 240 XP» */
export function levelTag(me: Pick<MeOut, "level" | "xp"> | undefined) {
  if (!me) return null;
  return t("wallet.levelTag", { level: me.level, xp: fmtNum(me.xp) });
}

type Panel3 = "withdraw" | "history" | "settings" | "wallet" | "topup" | null;

/**
 * «Профиль» (/wallet, псевдоним /profile, DESIGN.md §14.1): уровень в шапке, баланс,
 * строки «Вывод», «История», «Настройки» (каждая открывает шторку) и последним — «Управление» команды.
 */
export function Wallet() {
  const { data: me, refetch } = useMe();
  const mine = useMyWithdrawals();
  const limits = useWithdrawLimits();
  const qc = useQueryClient();
  const { data: walletInfo } = useWallet();
  const { data: depositInfo } = useDepositInfo();
  const unlink = useWalletUnlink();
  const [typed, setAmount] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(false);
  // ?topup=1 — сразу открыть пополнение (ссылка «Пополнить» из «Арены» при нехватке на ставку)
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<Panel3>(() => (params.has("topup") ? "topup" : null));
  const [ask, setAsk] = useState(false);
  const toast = useToast();
  const recent = useRecentHistory(3);

  // баланс изменился (зачисление пополнения, сбор, вывод) — история тоже устарела
  const balanceKey = me?.balance;
  useEffect(() => {
    if (balanceKey != null) qc.invalidateQueries({ queryKey: ["balance"] });
  }, [balanceKey, qc]);

  const min = limits.data ? Number(limits.data.min_ton) : null;
  const amount = typed ?? (limits.data?.min_ton ? String(Number(limits.data.min_ton)) : "");
  const sum = Number(amount.replace(",", "."));
  const balance = me ? Number(me.balance) : null;
  const list = mine.data || [];
  const pending = list.find((w) => w.status === "pending" || w.status === "sending");
  const addr = wallet.trim();
  const addrOk = TON_ADDR.test(addr);

  // Кнопка отражает доступность (п. 14, правило 13): первая причина, почему вывести нельзя
  const why = !amount.trim() || !Number.isFinite(sum) || sum <= 0
      ? t("wallet.enterAmount")
      : min != null && sum < min
        ? t("wallet.minWithdraw", { v: min })
        : balance != null && sum > balance
          ? t("wallet.balanceLess", { balance: balance.toFixed(4) })
          : !addr
            ? t("wallet.enterAddress")
            : !addrOk
              ? t("wallet.addressFormat")
              : null;
  const ready = !why;
  const closeSheet = () => {
    setSheet(null);
    setAsk(false);
    if (params.has("topup")) setParams((p) => { p.delete("topup"); return p; }, { replace: true });
  };

  async function submit() {
    setLoading(true);
    try {
      await api("/api/v1/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount: amount.replace(",", "."), wallet_address: addr }),
      });
      toast({ kind: "ok", title: t("wallet.requestCreated"), sub: t("wallet.requestCreatedSub", { amount }) });
      closeSheet();
      refetch();
      mine.refetch();
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e) {
      setAsk(false);
      toast({ kind: "danger", title: t("wallet.requestFailed"), sub: e instanceof Error ? e.message : t("ui.error") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <ScreenHeader
        title={t("nav.profile")}
        action={
          me ? (
            <Link to="/ratings?t=level&from=profile" className="rt-tagl no-underline" aria-label={t("wallet.levelRankAria", { tag: levelTag(me) ?? "" })}>
              <Tag tone="amber" dot={false}>
                {levelTag(me)}
              </Tag>
            </Link>
          ) : undefined
        }
      />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Panel level="hero" see cut="l" lift="l2" className="p-5">
          <p className="ui-label ui-shade">{t("wallet.available")}</p>
          <Num
            value={me ? Number(me.balance).toFixed(4) : "—"}
            unit="TON"
            size="xl"
            glow
            className="ui-shade mt-2 block !text-[40px] !leading-[48px]"
          />
          {me && (me.focus_tokens > 0 || me.block_tokens > 0) && (
            <p className="ui-sec ui-shade mt-1 !text-[12px] !leading-[16px]">
              {t("wallet.tokensFocus")}{" "}<span className="ui-num text-[var(--text)]">{me.focus_tokens}</span>{" "}{t("wallet.tokensBlock")}{" "}
              <span className="ui-num text-[var(--text)]">{me.block_tokens}</span>
            </p>
          )}
        </Panel>
      </motion.div>

      <ProfileRanks />

      <List>
        <ListRow
          icon={<IconWallet size={20} />}
          title={t("wallet.tonWallet")}
          sub={walletInfo?.wallet ? shortAddr(walletInfo.wallet.address) : t("wallet.notLinked")}
          trailing={<Tag tone={walletInfo?.wallet ? "ok" : "neutral"}>{walletInfo?.wallet ? t("wallet.linked") : t("wallet.linkAction")}</Tag>}
          onClick={() => setSheet("wallet")}
        />
        <ListRow
          icon={<IconOut size={20} />}
          title={t("wallet.topUp")}
          sub={depositInfo?.enabled ? t("wallet.topUpSub", { minTon: depositInfo.min_ton }) : t("wallet.soon")}
          onClick={() => setSheet("topup")}
        />
        <ListRow
          icon={<IconOut size={20} />}
          title={t("wallet.withdraw")}
          sub={
            pending
              ? `${Number(pending.amount).toFixed(4)} TON ${pending.status === "sending" ? t("wallet.onTheWay") : t("wallet.inReview")}`
              : min != null
                ? t("wallet.withdrawSubMin", { v: min })
                : t("wallet.withdrawSub")
          }
          trailing={pending ? <Tag tone={pending.status === "sending" ? "neon" : "warn"}>{pending.status === "sending" ? t("wallet.sending") : t("wallet.pendingShort")}</Tag> : undefined}
          onClick={() => setSheet("withdraw")}
        />
        <ListRow
          icon={<IconHistory size={20} />}
          iconTone="muted"
          title={t("wallet.history")}
          sub={t("wallet.historySub")}
          onClick={() => setSheet("history")}
        />
        <ListRow icon={<IconGear size={20} />} iconTone="muted" title={t("settings.title")} sub={t("settings.rowSub")} onClick={() => setSheet("settings")} />
      </List>

      {recent.data && recent.data.pending.length + recent.data.items.length > 0 ? (
        <section className="space-y-2" aria-label={t("wallet.recent")}>
          <SectionLabel
            action={
              <Button kind="ghost" size="sm" onClick={() => setSheet("history")}>
                {t("wallet.allHistory")}</Button>
            }
          >
            {t("wallet.recent")}</SectionLabel>
          <List>
            {[...recent.data.pending, ...recent.data.items].slice(0, 3).map((it) => (
              <HistoryRow key={String(it.id)} item={it} />
            ))}
          </List>
        </section>
      ) : null}

      {/* «Управление» команды — последним разделом; игроку не рендерится (видимость по роли — в WorkArea) */}
      <WorkArea />

      <Sheet
        open={sheet === "withdraw"}
        onClose={closeSheet}
        title={t("wallet.withdrawTon")}
        sub={ask ? t("wallet.checkConfirm") : pending ? t("wallet.requestInReview") : t("wallet.balanceTon", { balance: balance != null ? balance.toFixed(4) : "—" })}
        footer={
          pending ? undefined : ask ? (
            <div className="grid gap-2">
              <HoldButton block disabled={loading} onConfirm={submit}>
                {t("wallet.holdToWithdraw")}</HoldButton>
              <Button kind="ghost" block onClick={() => setAsk(false)}>
                {t("wallet.backToForm")}</Button>
            </div>
          ) : (
            <span className="ui-spill">
              <Button kind="primary" size="lg" block icon={<IconOut size={20} />} disabled={loading || !ready} aria-describedby={why ? "withdraw-why" : undefined} onClick={() => setAsk(true)}>
                {t("wallet.requestWithdraw")}</Button>
            </span>
          )
        }
      >
        {pending ? (
          // Пока заявка на проверке, форма не нужна: новую всё равно не создать — показываем статус
          <div className="space-y-3" aria-live="polite">
            <Num value={Number(pending.amount).toFixed(4)} unit="TON" size="l" className="block" />
            <p className="mono text-[12px] leading-[16px] text-[var(--text-2)]">
              {[shortAddr(pending.wallet_address || ""), whenLabel(pending.created_at)].filter(Boolean).join(" · ")}
            </p>
            <p className="ui-sec">
              {pending.status === "sending"
                ? t("wallet.sentNote")
                : t("wallet.frozenNote")}
            </p>
          </div>
        ) : ask ? (
          <div>
            <p className="ui-label">{t("topup.amount")}</p>
            <Num value={amount.trim()} unit="TON" size="l" className="mt-1 block" />
            <p className="ui-label mt-4">{t("wallet.toAddress")}</p>
            <p className="mono mt-1 break-all text-[13px] leading-snug text-[var(--text)]">{addr}</p>
            <p className="ui-sec mt-4">{t("wallet.freezeNow")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="ui-sec">
              {t("wallet.freezeNote")}{min != null && t("wallet.minNote", { v: min })}
            </p>
            <Field label={t("topup.amount")} unit="TON">
              <input className="ui-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t("wallet.tonAddress")}>
              <input
                className="ui-input"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="UQ… / EQ…"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {why && (
              <p id="withdraw-why" className="ui-sec !text-[12px] !leading-[16px]">
                {why}
              </p>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === "topup"} onClose={closeSheet} title={t("wallet.topUpTitle")}>
        <TopUpSheet info={depositInfo} onClose={closeSheet} />
      </Sheet>
      <Sheet open={sheet === "wallet"} onClose={closeSheet} title={t("wallet.tonWallet")}>
        <LazyTonConnectProvider>
          <WalletConnectSheet
            linked={walletInfo?.wallet ?? null}
            onLinked={() => { qc.invalidateQueries({ queryKey: ["wallet"] }); setSheet(null); }}
            onUnlink={() => unlink.mutate(undefined, { onError: (e) => toast({ kind: "danger", title: e instanceof Error ? e.message : t("ui.error") }) })}
          />
        </LazyTonConnectProvider>
      </Sheet>

      <Sheet open={sheet === "history"} onClose={closeSheet} title={t("wallet.history")} sub={t("wallet.allInTon")}>
        <BalanceHistorySheet />
      </Sheet>

      <Sheet open={sheet === "settings"} onClose={closeSheet} title={t("settings.title")} sub={t("settings.sub")}>
        <SettingsInfo />
      </Sheet>
    </div>
  );
}

/**
 * Настройки: тема идёт из Telegram, анимации — из системы и мощности устройства; язык выбирается здесь
 * («Язык / Language» — подпись на обоих языках, чтобы найти её на любом) и хранится на сервере.
 */
function SettingsInfo() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const theme = root?.dataset.theme === "light" ? t("settings.themeDay") : t("settings.themeNight");
  const lowEnd = !!root?.classList.contains("low-end");
  const motionMode = prefersReducedMotion() ? t("settings.motionReduced") : lowEnd ? t("settings.motionLite") : t("settings.motionFull");
  const lang = useLangStore((st) => st.lang);
  const setLang = useSetLang();
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <SectionLabel>{t("lang.title")}</SectionLabel>
        <Tabs<Lang>
          label={t("lang.title")}
          items={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          value={lang}
          onChange={(l) => setLang.mutate(l)}
        />
        <p className="ui-sec !text-[12px] !leading-[16px]">{t("lang.sub")}</p>
      </div>
      <List>
        <ListRow title={t("settings.theme")} sub={t("settings.themeSub")} value={theme} />
        <ListRow title={t("settings.motion")} sub={t("settings.motionSub")} value={motionMode} />
      </List>
      <p className="ui-sec !text-[12px] !leading-[16px]">{t("settings.note")}</p>
    </div>
  );
}
