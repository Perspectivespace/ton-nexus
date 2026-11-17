import { useState } from "react";
import { useClientErrorDetail, useClientErrors, useClientErrorsClear, type ClientErrorItem } from "@/api/hooks";
import { Button, EmptyPanel, ErrorPanel, List, ListRow, LoadingPanel, SectionLabel, StatTile, StatusPill } from "@/components/ui";

/** Ошибки приложения у игроков (P6): сгруппированы по отпечатку, без личных данных. Кабинет — на русском. */
const KIND_RU: Record<ClientErrorItem["kind"], string> = { error: "ошибка", rejection: "промис", render: "экран" };
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Detail({ id }: { id: number }) {
  const { data, isLoading } = useClientErrorDetail(id);
  if (isLoading) return <p className="ui-sec px-4 pb-3">Загрузка…</p>;
  if (!data) return null;
  return (
    <div className="space-y-1 px-4 pb-3">
      <p className="ui-sys break-words">
        сборка {data.build ?? "—"} · {data.platform ?? "—"} · впервые {when(data.first_seen_at)}
      </p>
      {data.stack ? <pre className="ce-stack">{data.stack}</pre> : <p className="ui-sec">Стека нет.</p>}
    </div>
  );
}

export function ClientErrorsOwner() {
  const { data, isLoading, error, refetch, isFetching } = useClientErrors();
  const clear = useClientErrorsClear();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <SectionLabel
        action={
          <Button kind="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "обновляю…" : "обновить"}
          </Button>
        }
      >
        Ошибки приложения
      </SectionLabel>
      {isLoading && <LoadingPanel label="Загрузка ошибок…" />}
      {error && <ErrorPanel message="Не удалось загрузить ошибки" />}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="за 24 ч" value={data.groups_24h} sub="видов" />
            <StatTile label="за 7 дней" value={data.groups_7d} sub="видов" />
            <StatTile label="всего" value={data.events} sub="случаев" />
          </div>
          {data.items.length === 0 ? (
            <EmptyPanel title="Ошибок нет" body="Сюда попадают сбои у игроков: необработанные ошибки, отклонённые промисы и падения экрана." />
          ) : (
            <>
              <List>
                {data.items.map((it) => (
                  <div key={it.id}>
                    <ListRow
                      title={<span className="ce-msg">{it.message}</span>}
                      sub={`${KIND_RU[it.kind] ?? it.kind} · ${it.route ?? "—"} · игроков ${it.users} · ${when(it.last_seen_at)}`}
                      trailing={<StatusPill tone={it.count >= 10 ? "warn" : "neutral"}>×{it.count}</StatusPill>}
                      chevron={false}
                      onClick={() => setOpen(open === it.id ? null : it.id)}
                    />
                    {open === it.id && <Detail id={it.id} />}
                  </div>
                ))}
              </List>
              <Button
                kind="ghost"
                size="sm"
                disabled={clear.isPending}
                onClick={() => {
                  if (window.confirm("Очистить список ошибок? Новые случаи появятся снова.")) clear.mutate(undefined);
                }}
              >
                Очистить список
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
