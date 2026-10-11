"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";
import { readApiResponse } from "@/src/utils/api";

type ChainCheck = {
  chain: string;
  code: string;
  callbackUrl: string | null;
  hasApiKey: boolean;
  callbackMatchesSite: boolean;
};

type CallbackMap = { btc: string; bnb: string; eth: string; trx: string; sol: string };

type Report = {
  configured: boolean;
  callbackUrl: string;
  callbackUrlMap?: CallbackMap;
  merchantPayload?: { callback_url: CallbackMap };
  expectedChain: string;
  expectedChainCode: string;
  paymentCurrency: string;
  store: { id: string | number; name: string | null; tag: string | null } | null;
  chains: ChainCheck[];
  missingCallbackChains: string[];
  error?: string;
};

export default function BconStoreCheck() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState<"url" | "object" | string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyError, setApplyError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/bcon", { cache: "no-store" });
      setReport(await readApiResponse<Report>(response));
    } catch (error: any) {
      setReport({
        configured: false,
        callbackUrl: "",
        expectedChain: "",
        expectedChainCode: "",
        paymentCurrency: "",
        store: null,
        chains: [],
        missingCallbackChains: [],
        error: error.message || "Could not read the Bcon store",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const callbackObject = report?.merchantPayload?.callback_url || report?.callbackUrlMap;
  const callbackJson = callbackObject
    ? JSON.stringify({ callback_url: callbackObject }, null, 2)
    : report?.callbackUrl
      ? JSON.stringify(
          {
            callback_url: {
              btc: report.callbackUrl,
              bnb: report.callbackUrl,
              eth: report.callbackUrl,
              trx: report.callbackUrl,
              sol: report.callbackUrl,
            },
          },
          null,
          2
        )
      : "";

  async function copyText(label: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  async function applyCallbacks() {
    setApplying(true);
    setApplyError("");
    setApplyMessage("");
    try {
      const response = await fetch("/api/admin/bcon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply-callbacks" }),
      });
      const json = await readApiResponse<{ ok: boolean; applied: boolean; error?: string; report?: Report }>(response);
      if (json.report) setReport(json.report);
      if (json.ok) setApplyMessage("Callback URLs were written to the Bcon store as strings.");
      else setApplyError(json.error || "Bcon did not accept the store update. Paste the JSON object below into merchant-platforms.");
    } catch (error: any) {
      setApplyError(error.message || "Could not update the Bcon store");
    } finally {
      setApplying(false);
    }
  }

  const allGood = Boolean(report?.configured) && (report?.chains.length || 0) > 0 && (report?.missingCallbackChains.length || 0) === 0;

  return (
    <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">Bcon store — callback_url must be strings</p>
          <p className="mt-1 text-[11px] text-ink-3">
            Merchant-platforms validates <code className="font-mono">callback_url.btc</code>,{" "}
            <code className="font-mono">callback_url.bnb</code> and the other chains as <em>strings inside an object</em>. A
            bare URL in that field is what triggers “The callback_url.btc must be a string.”
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={applyCallbacks}
            disabled={loading || applying || !report?.configured}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50"
          >
            {applying ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud aria-hidden="true" className="h-3.5 w-3.5" />}
            Apply string callbacks
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
            Re-check
          </button>
        </div>
      </div>

      {callbackJson && (
        <div className="mt-3 rounded-md border border-line bg-void p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-ink-2">Paste this object into merchant-platforms → callback_url</p>
            <button
              type="button"
              onClick={() => copyText("object", callbackJson)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] hover:bg-white/5"
            >
              {copied === "object" ? <Check aria-hidden="true" className="h-3 w-3 text-emerald-300" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
              {copied === "object" ? "Copied" : "Copy JSON"}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-accent">{callbackJson}</pre>
        </div>
      )}

      {report?.callbackUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-void px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink-2">{report.callbackUrl}</code>
          <button
            type="button"
            onClick={() => copyText("url", report.callbackUrl)}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] hover:bg-white/5"
          >
            {copied === "url" ? <Check aria-hidden="true" className="h-3 w-3 text-emerald-300" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
            {copied === "url" ? "Copied" : "Copy URL"}
          </button>
        </div>
      )}

      {report && (
        <p className="mt-2 text-[11px] text-ink-3">
          Expected chain <span className="font-mono text-ink-2">{report.expectedChain || "—"}</span> (
          <span className="font-mono text-ink-2">{report.expectedChainCode || "—"}</span>) · payment currency{" "}
          <span className="font-mono text-ink-2">{report.paymentCurrency || "—"}</span>
          {report.store ? <> · store “{report.store.name || report.store.id}”</> : null}
        </p>
      )}

      {applyMessage && (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-emerald-500/10 p-3 text-[11.5px] text-emerald-200">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {applyMessage}
        </p>
      )}
      {applyError && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-[11.5px] text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {applyError}
        </p>
      )}

      {report?.error && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-[11.5px] text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {report.error}
        </p>
      )}

      {report && report.chains.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-[11.5px]">
            <thead className="border-b border-line bg-void text-[10px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2">Chain</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">API key</th>
                <th className="px-3 py-2">callback_url.&lt;code&gt;</th>
              </tr>
            </thead>
            <tbody>
              {report.chains.map((chain) => (
                <tr key={`${chain.chain}-${chain.code}`} className="border-b border-line/50">
                  <td className="px-3 py-2 capitalize">{chain.chain || chain.code}</td>
                  <td className="px-3 py-2 font-mono text-ink-3">{chain.code}</td>
                  <td className="px-3 py-2">
                    {chain.hasApiKey ? <span className="text-emerald-300">present</span> : <span className="text-amber-300">missing</span>}
                  </td>
                  <td className="px-3 py-2">
                    {chain.callbackUrl ? (
                      <span className={chain.callbackMatchesSite ? "text-emerald-300" : "text-amber-300"}>
                        {chain.callbackMatchesSite ? "string · matches this site" : `set to ${chain.callbackUrl}`}
                      </span>
                    ) : (
                      <span className="text-red-300">empty — callback_url.{chain.code} must be a string</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allGood && (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-emerald-500/10 p-3 text-[11.5px] text-emerald-200">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Every chain on the store has a string callback URL set.
        </p>
      )}

      {report && report.missingCallbackChains.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-200">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Bcon will reject merchant-platforms until these are strings:{" "}
            {report.missingCallbackChains.map((code) => `callback_url.${code}`).join(", ")}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Do not paste a single URL into the callback_url field — that field is an object.</li>
            <li>Paste the JSON object above, or fill each chain box with the same https URL as a plain string (no quotes, no Markdown).</li>
            <li>BTC, BNB and at least one more chain are validated even when unused, which is the “and 2 more errors”.</li>
            <li>Click “Apply string callbacks” to push the object through Bcon’s API, then save the store.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
