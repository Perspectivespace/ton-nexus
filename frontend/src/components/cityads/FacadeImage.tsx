import { useId, useRef, useState } from "react";
import { useAuthImage, useCityAdImageUpload } from "@/api/hooks";
import { haptic } from "@/lib/haptics";
import { FACADE_ACCEPT, FACADE_H, FACADE_W, facadeFileError, shrinkForUpload } from "@/lib/facadeImage";

/**
 * Картинка экрана на фасаде (необязательно): выбор файла → загрузка → сервер проверяет и пережимает (WebP 640×520,
 * кадр по центру, без метаданных) → превью уже пережатой картинки — ровно то, что будет на экране.
 * Картинку проверяет владелец вместе с текстом; без картинки экран показывает заголовок и подпись.
 */
export type FacadePick = { id: number; path: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : "Не удалось загрузить картинку");

export function FacadeImagePicker({
  value,
  onChange,
  label = "Картинка на экране",
  note = "Картинку проверит владелец вместе с текстом.",
}: {
  value: FacadePick | null;
  onChange: (v: FacadePick | null) => void;
  label?: string;
  note?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const up = useCityAdImageUpload();
  const [err, setErr] = useState<string | null>(null);
  const { url } = useAuthImage(value?.path);

  async function pick(f: File | null) {
    setErr(null);
    if (!f) return;
    const bad = facadeFileError(f);
    if (bad) {
      setErr(bad);
      return;
    }
    try {
      const body = await shrinkForUpload(f);
      const r = await up.mutateAsync(body);
      haptic.select();
      onChange({ id: r.id, path: r.preview_url });
    } catch (e) {
      haptic.heavy();
      setErr(errText(e));
    }
  }

  const busy = up.isPending;
  return (
    <div className="cab-pic space-y-2" data-testid="facade-image">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="ui-flabel">
          {label}
        </label>
        <span className="cab-pic-opt">по желанию</span>
      </div>
      <input
        id={id}
        ref={input}
        type="file"
        accept={FACADE_ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          void pick(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {value ? (
        <div className="cab-pic-frame">
          {url ? <img src={url} alt="Картинка на экране после обработки" className="cab-pic-img" /> : <span className="cab-pic-img cab-pic-wait" />}
          <div className="cab-pic-bar">
            <span className="cab-pic-meta">
              {FACADE_W}×{FACADE_H} · WebP
            </span>
            <button type="button" className="ui-btn secondary sm" disabled={busy} onClick={() => input.current?.click()}>
              Заменить
            </button>
            <button type="button" className="ui-btn ghost sm" disabled={busy} onClick={() => (setErr(null), onChange(null))}>
              Убрать
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="cab-pic-drop" disabled={busy} onClick={() => input.current?.click()}>
          <span className="t">{busy ? "Загружаем и обрабатываем…" : "Выбрать картинку"}</span>
          <span className="s">PNG, JPG или WebP · до 5 МБ</span>
        </button>
      )}
      {busy && value && <p className="cab-note" role="status">Загружаем и обрабатываем…</p>}
      {err && (
        <p className="ui-fhint err" role="alert">
          {err}
        </p>
      )}
      <p className="cab-note">
        Обрежем по центру до пропорции экрана ({FACADE_W}×{FACADE_H}) и уберём данные о месте и устройстве. Без картинки экран
        покажет заголовок и подпись. {note}
      </p>
    </div>
  );
}
