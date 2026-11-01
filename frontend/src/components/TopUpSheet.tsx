import { useState } from "react";
import { Button, Field, useToast } from "@/components/ui";
import { haptic } from "@/lib/haptics";

type Props = {
  info: { enabled: boolean; project_address: string; memo: string; min_ton: string } | undefined;
  onClose: () => void;
};

export function TopUpSheet({ info, onClose }: Props) {
  void onClose;
  const [amount, setAmount] = useState("1");
  const [showManual, setShowManual] = useState(false);
  const toast = useToast();

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    haptic.select();
    toast({ title: "Скопировано" });
  };

  return (
    <div className="space-y-4">
      <Field label="Сумма TON">
        <input
          className="input-field mono"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(",", "."))}
        />
      </Field>
      <div className="flex gap-2">
        {["1", "5", "10"].map((v) => (
          <button key={v} type="button" className="min-h-[44px] flex-1 rounded-lg border border-[var(--line)] text-[13px]" onClick={() => setAmount(v)}>
            {v} TON
          </button>
        ))}
      </div>
      <Button className="w-full !h-[52px]" disabled={!info?.enabled}>
        Пополнить
      </Button>
      <button type="button" className="text-[12px] text-[var(--text-dim)]" onClick={() => setShowManual((v) => !v)}>
        {showManual ? "Скрыть" : "Перевод с биржи или другого кошелька"}
      </button>
      {showManual && info && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          <p className="text-[11px] text-[var(--text-dim)]">Адрес проекта</p>
          <p className="font-mono text-[12px] break-all">{info.project_address || "—"}</p>
          <Button className="w-full" onClick={() => copy(info.project_address)}>Скопировать адрес</Button>
          <p className="text-[11px] text-[var(--text-dim)]">Комментарий (мемо)</p>
          <p className="font-mono text-lg">{info.memo}</p>
          <Button className="w-full" onClick={() => copy(info.memo)}>Скопировать мемо</Button>
          <p className="text-[12px] text-[var(--warn)]">Обязательно укажите комментарий {info.memo}, иначе зачисление вручную через поддержку</p>
        </div>
      )}
    </div>
  );
}
