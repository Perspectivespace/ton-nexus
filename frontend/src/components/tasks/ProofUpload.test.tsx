// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProofImage, ProofUpload, PROOF_MAX_BYTES, fmtSize, proofFileError } from "./ProofUpload";

const noop = () => {};

describe("ProofUpload", () => {
  it("принимает только PNG/JPG/WebP до 5 МБ", () => {
    expect(proofFileError(null)).toBeNull();
    expect(proofFileError({ type: "image/png", size: 1000 })).toBeNull();
    expect(proofFileError({ type: "image/jpeg", size: PROOF_MAX_BYTES })).toBeNull();
    expect(proofFileError({ type: "image/webp", size: 10 })).toBeNull();
    expect(proofFileError({ type: "image/gif", size: 10 })).toMatch(/PNG, JPG или WebP/);
    expect(proofFileError({ type: "image/svg+xml", size: 10 })).toMatch(/PNG/);
    expect(proofFileError({ type: "", size: 10 })).toMatch(/PNG/);
    expect(proofFileError({ type: "image/png", size: PROOF_MAX_BYTES + 1 })).toMatch(/5 МБ/);
    expect(proofFileError({ type: "image/png", size: 0 })).toMatch(/Пустой/);
    expect(fmtSize(2 * 1024 * 1024)).toBe("2.0 МБ");
    expect(fmtSize(300)).toBe("1 КБ");
  });

  it("шаг загрузки: обязательность, accept, подсказка про 24 ч", () => {
    const html = renderToStaticMarkup(<ProofUpload file={null} onChange={noop} required />);
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain("обязательно");
    expect(html).toContain("Выбрать скриншот");
    expect(html).toContain("24 ч");
    expect(renderToStaticMarkup(<ProofUpload file={null} onChange={noop} required={false} />)).toContain("по желанию");
  });

  it("удалённый скриншот не запрашивается", () => {
    const qc = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <ProofImage proofId={5} state="deleted" />
      </QueryClientProvider>,
    );
    expect(html).toContain("удалён");
    expect(qc.getQueryCache().find({ queryKey: ["proof-image", null] })?.state.fetchStatus ?? "idle").toBe("idle");
  });
});
