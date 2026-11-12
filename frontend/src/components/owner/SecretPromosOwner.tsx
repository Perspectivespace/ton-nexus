import { useState } from "react";
import { useSecretPromoCreate, useSecretPromoDisable, useSecretPromos, type SecretPromo } from "@/api/hooks";
import { Button, EmptyPanel, ErrorPanel, Field, List, ListRow, LoadingPanel, Panel, SectionLabel, StatusPill } from "@/components/ui";

/**
 * Секретные промокоды «Прогулки» (владелец): создать кампанию, список со счётчиками, выключить.
 * Время и места появлений сервер разыгрывает сам и не показывает никому — здесь только числа.
 */
const STATUS: Record<SecretPromo["status"], [string, "ok" | "neutral" | "warn"]> = {
  active: ["идёт", "ok"],
  exhausted: ["активации кончились", "neutral"],
  finished: ["срок вышел", "neutral"],
  disabled: ["выключена", "warn"],
};

const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);

function CreateForm() {
  const create = useSecretPromoCreate();
  const [code, setCode] = useState("");
  const [ton, setTon] = useState("0.5");
  const [uses, setUses] = useState("50");
  const [days, setDays] = useState("7");
  const [perDay, setPerDay] = useState("3");
  const [msg, setMsg] = useState<string | null>(null);
  const nums = [int(uses), int(days), int(perDay)];
  const ok = /^[A-Z0-9-]{4,16}$/.test(code) && Number(ton) > 0 && nums.every((n) => n >= 1);

  async function submit() {
    setMsg(null);
    try {
      const r = await create.mutateAsync({ code, reward_ton: ton.trim(), max_uses: nums[0], days: nums[1], per_day: nums[2] });
      setMsg(`Кампания ${r.code} запущена: ${r.appearances_total} появлений`);
      setCode("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <Panel className="space-y-3 p-4">
      <p className="ui-label">Новая кампания</p>
      <p className="ui-sec">
        Код появляется голограммой только в «Прогулке»: в случайное время суток, в случайной локации (Центр, Неон-ряды, Порт), на 3–10
        минут. Ввести его можно, пока он виден, и ещё 10 минут после. Время появлений не видит никто, в том числе вы.
      </p>
      <Field label="Код" hint="4–16 знаков: латиница, цифры, дефис">
        <input
          className="ui-input uppercase tracking-wider"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16))}
          placeholder="SIGNAL-01"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Награда" unit="TON">
          <input className="ui-input" inputMode="decimal" value={ton} onChange={(e) => setTon(e.target.value)} />
        </Field>
        <Field label="Всего активаций">
          <input className="ui-input" inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value)} />
        </Field>
        <Field label="Дней" unit="сут">
          <input className="ui-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Появлений в сутки">
          <input className="ui-input" inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        </Field>
      </div>
      <Button kind="primary" block disabled={create.isPending || !ok} onClick={submit}>
        {create.isPending ? "…" : "Запустить кампанию"}
      </Button>
      {msg && (
        <p className="ui-sec" role="status">
          {msg}
        </p>
      )}
    </Panel>
  );
}

export function SecretPromosOwner() {
  const { data, isLoading, error } = useSecretPromos();
  const disable = useSecretPromoDisable();
  return (
    <div className="space-y-3">
      <SectionLabel>Секретный код в «Прогулке»</SectionLabel>
      <CreateForm />
      {isLoading ? (
        <LoadingPanel label="Загрузка кампаний…" />
      ) : error ? (
        <ErrorPanel message="Не удалось загрузить кампании" />
      ) : !data?.length ? (
        <EmptyPanel title="Кампаний нет" body="Запустите первую выше." />
      ) : (
        <List>
          {data.map((c) => {
            const [label, tone] = STATUS[c.status];
            return (
              <ListRow
                key={c.id}
                title={<span className="ui-num s-m">{c.code}</span>}
                sub={`${c.reward_ton} TON · ${c.used_count}/${c.max_uses} акт. · ${c.appearances_done}/${c.appearances_total} появл.`}
                chevron={false}
                trailing={
                  c.status === "active" ? (
                    <Button kind="ghost" size="sm" disabled={disable.isPending} onClick={() => disable.mutate(c.id)}>
                      Выключить
                    </Button>
                  ) : (
                    <StatusPill tone={tone}>{label}</StatusPill>
                  )
                }
              />
            );
          })}
        </List>
      )}
    </div>
  );
}
