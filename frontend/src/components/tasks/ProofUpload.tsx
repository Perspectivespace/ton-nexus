import { useEffect, useId, useRef, useState } from "react";
import { useProofImage } from "@/api/hooks";
import { StatusPill } from "@/components/ui";
import { t } from "@/i18n";

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_ACCEPT = "image/png,image/jpeg,image/webp";
const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Проверка файла до загрузки (сервер проверяет ещё раз по содержимому). null — файл подходит. */
export function proofFileError(f: { type: string; size: number } | null): string | null {
  if (!f) return null;
  if (!OK_TYPES.includes(f.type)) return t("proof.needImage");
  if (f.size <= 0) return t("proof.empty");
  if (f.size > PROOF_MAX_BYTES) return t("proof.tooBig");
  return null;
}

export function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? t("proof.mb", { v: (n / 1024 / 1024).toFixed(1) }) : t("proof.kb", { n: Math.max(1, Math.round(n / 1024)) });
}

/** Шаг «скриншот» при сдаче задания: выбор файла, превью, проверка размера/типа. */
export function ProofUpload({
  file,
  onChange,
  required,
  disabled,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  required: boolean;
  disabled?: boolean;
}) {
  const inputId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const err = proofFileError(file);

  useEffect(() => {
    if (!file || err) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file, err]);

  return (
    <div className="space-y-2" data-testid="proof-upload">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="ui-label">
          {t("proof.title")}</label>
        <StatusPill tone={required ? (file && !err ? "ok" : "warn") : "neutral"}>
          {required ? (file && !err ? t("proof.attached") : t("proof.required")) : t("proof.optional")}
        </StatusPill>
      </div>
      <input
        id={inputId}
        ref={ref}
        type="file"
        accept={PROOF_ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {preview && file ? (
        <div className="proof-frame">
          <img src={preview} alt={t("proof.title")} className="proof-img" />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-dim)]">
              {fmtSize(file.size)} · {file.type.replace("image/", "").toUpperCase()}
            </span>
            <button type="button" className="ui-btn secondary sm" disabled={disabled} onClick={() => onChange(null)}>
              {t("proof.remove")}</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="proof-drop"
          disabled={disabled}
          onClick={() => ref.current?.click()}
        >
          <span className="text-[14px] font-semibold">{t("proof.pick")}</span>
          <span className="text-[12px] text-[var(--text-dim)]">{t("proof.formats")}</span>
        </button>
      )}
      {err && <p className="text-[12px] text-[var(--danger-text)]">{err}</p>}
      <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
        {t("proof.privacy")}</p>
    </div>
  );
}

/** Скриншот заявки в экране проверки: грузится с авторизацией, не кэшируется. */
export function ProofImage({ proofId, state }: { proofId: number | null | undefined; state?: string | null }) {
  const deleted = state === "deleted";
  const { url, isLoading, error } = useProofImage(deleted ? null : proofId);
  if (proofId == null) return null;
  return (
    <div className="space-y-1.5" data-testid="proof-image">
      <p className="ui-label">{t("proof.screenshot")}</p>
      {deleted ? (
        <p className="text-[12px] text-[var(--text-dim)]">{t("proof.expired")}</p>
      ) : url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="proof-frame block">
          <img src={url} alt={t("proof.alt")} className="proof-img" />
        </a>
      ) : (
        <div className="proof-frame grid h-32 place-items-center text-[12px] text-[var(--text-dim)]">
          {isLoading ? t("proof.loading") : error instanceof Error ? error.message : t("proof.unavailable")}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-dim)]">{t("proof.deleteNote")}</p>
    </div>
  );
}
