import { useCallback, useState } from "react";
import { useTonConnectUI } from "@tonconnect/ui-react";
import { Button, HoldButton, useToast } from "@/components/ui";
import { api } from "@/api/client";
import { haptic } from "@/lib/haptics";

type Props = {
  linked: { address: string; wallet_app: string | null } | null;
  onLinked: () => void;
  onUnlink: () => void;
};

export default function WalletConnectSheetInner({ linked, onLinked, onUnlink }: Props) {
  const [tonConnectUI] = useTonConnectUI();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startLink = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // Reset previous session for "change wallet"
      if (tonConnectUI.connected) {
        await tonConnectUI.disconnect();
      }
      const { payload } = await api<{ payload: string }>("/api/v1/wallet/proof-payload", { method: "POST" });
      tonConnectUI.setConnectRequestParameters({ state: "ready", value: { tonProof: payload } });

      let unsub: (() => void) | undefined;
      unsub = tonConnectUI.onStatusChange(async (w) => {
        if (w?.connectItems?.tonProof && "proof" in w.connectItems.tonProof) {
          try {
            await api("/api/v1/wallet/link", {
              method: "POST",
              body: JSON.stringify({
                account: w.account,
                proof: w.connectItems.tonProof.proof,
                wallet_app: w.device?.appName,
              }),
            });
            onLinked();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Ошибка привязки");
          } finally {
            setLoading(false);
            unsub?.();
          }
        }
      });

      await tonConnectUI.openModal();
      // If user closes modal without connecting, reset loading
      setTimeout(() => setLoading(false), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setLoading(false);
    }
  }, [tonConnectUI, onLinked]);

  const copy = () => {
    if (linked) {
      navigator.clipboard?.writeText(linked.address);
      haptic.select();
      toast({ title: "Скопировано" });
    }
  };

  if (linked) {
    return (
      <div className="space-y-4">
        <p className="font-mono text-[13px] break-all">{linked.address}</p>
        <Button className="w-full" onClick={copy}>Скопировать</Button>
        <Button className="w-full" onClick={startLink} disabled={loading}>Сменить кошелёк</Button>
        <HoldButton block onConfirm={onUnlink}>Отвязать</HoldButton>
        {error && (
          <p className="text-[12px] text-[var(--danger)]">
            {error}{" "}
            <button className="min-h-[44px] px-3" onClick={startLink}>Повторить</button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--text-dim)]">Подтвердите, что кошелёк ваш: приложение кошелька попросит подпись. Деньги не списываются.</p>
      <Button className="w-full !h-[52px]" onClick={startLink} disabled={loading}>
        {loading ? "Ожидание…" : "Привязать кошелёк"}
      </Button>
      {error && (
        <p className="text-[12px] text-[var(--danger)]">
          {error}{" "}
          <button className="min-h-[44px] px-3" onClick={startLink}>Повторить</button>
        </p>
      )}
    </div>
  );
}
