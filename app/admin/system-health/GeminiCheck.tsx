"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { readApiResponse } from "@/src/utils/api";

type Diagnostics = {
  configured: boolean;
  keyKind: "authorization" | "standard" | "unknown" | "missing";
  startBackend: string;
  crossBackendFallback: boolean;
  resolvedBackend: string | null;
  model: string;
  modelCandidates: string[];
  apiVersion: string;
  maxOutputTokens: number;
  thinkingConfigured: boolean;
};

type Probe = {
  ok: boolean;
  configured: boolean;
  keyKind: Diagnostics["keyKind"];
  backend: string;
  model: string;
  latencyMs: number;
  error?: string;
  hint?: string;
};

const KEY_KIND_LABEL: Record<Diagnostics["keyKind"], string> = {
  authorization: "AQ. authorization key",
  standard: "AIza standard key",
  unknown: "key set (unrecognised format)",
  missing: "no key",
};

export default function GeminiCheck() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/gemini/health", { cache: "no-store" });
      setDiagnostics(await readApiResponse<Diagnostics>(response));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Could not read the Gemini configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runProbe() {
    setProbing(true);
    setProbe(null);
    setError("");
    try {
      const response = await fetch("/api/admin/gemini/health", { method: "POST" });
      const json = await readApiResponse<{ probe: Probe }>(response);
      setProbe(json.probe);
    } catch (probeError: unknown) {
      const message = probeError instanceof Error ? probeError.message : "Gemini probe failed";
      setProbe({ ok: false, configured: Boolean(diagnostics?.configured), keyKind: diagnostics?.keyKind || "missing", backend: "—", model: diagnostics?.model || "—", latencyMs: 0, error: message });
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">Gemini — metadata suggestions</p>
          <p className="mt-1 text-[11px] text-ink-3">
            Title, description, and tags for new videos. If the key is rejected on the Gemini API, the request is retried
            once against Vertex express mode with the same key, and unknown models fall back to the current Flash models.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runProbe}
            disabled={probing || loading || !diagnostics?.configured}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            {probing ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />}
            Test Gemini
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
            Re-check setup
          </button>
        </div>
      </div>

      {diagnostics && (
        <p className="mt-3 text-[11px] text-ink-3">
          Key: <span className="text-ink-2">{KEY_KIND_LABEL[diagnostics.keyKind]}</span> · endpoint{" "}
          <span className="font-mono text-ink-2">{diagnostics.resolvedBackend || diagnostics.startBackend}</span> · model{" "}
          <span className="font-mono text-ink-2">{diagnostics.model}</span> · fallbacks{" "}
          <span className="font-mono text-ink-2">{diagnostics.modelCandidates.slice(1).join(", ") || "—"}</span> · output budget{" "}
          <span className="tabular-nums text-ink-2">{diagnostics.maxOutputTokens}</span> tokens
          {diagnostics.crossBackendFallback ? "" : " · cross-endpoint fallback disabled"}
        </p>
      )}

      {probe && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-md p-3 text-[11.5px] ${
            probe.ok ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"
          }`}
        >
          {probe.ok ? (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {probe.ok
              ? `Gemini answered on ${probe.backend} with ${probe.model} in ${probe.latencyMs} ms — metadata suggestions will be generated by AI.`
              : `Gemini probe failed on ${probe.backend} with ${probe.model}${probe.latencyMs ? ` after ${probe.latencyMs} ms` : ""}: ${probe.error || "no response"}`}
            {!probe.ok && probe.hint ? <span className="mt-1 block text-amber-100/90">{probe.hint}</span> : null}
          </span>
        </p>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-[11.5px] text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <p className="mt-3 text-[11px] text-ink-3">
        The probe spends a few tokens of real quota. Key values are never displayed — only whether a key is present and
        which format it uses.
      </p>
    </div>
  );
}
