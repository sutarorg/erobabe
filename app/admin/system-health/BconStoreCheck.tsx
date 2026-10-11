"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { readApiResponse } from "@/src/utils/api";

type ChainCheck = {
  chain: string;
  code: string;
  callbackUrl: string | null;
  hasApiKey: boolean;
  callbackMatchesSite: boolean;
};

type Report = {
  configured: boolean;
  callbackUrl: string;
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
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/bcon", { cache: "no-store" });
      setReport(await readApiResponse<Report>(response));
    } catch (error: any) {
      setReport({ ...({} as Report), configured: false, callbackUrl: "", expectedChain: "", expectedChainCode: "", paymentCurrency: "", store: null, chains: [], missingCallbackChains: [], error: error.message || "Could not read the Bcon store" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copyCallbackUrl() {
    if (!report?.callbackUrl) return;
    try {
      await navigator.clipboard.writeText(report.callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const allGood = Boolean(report?.configured) && (report?.chains.length || 0) > 0 && (report?.missingCallbackChains.length || 0) === 0;

  return (
    <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">Bcon store — callback URL per chain</p>
          <p className="mt-1 text-[11px] text-ink-3">
            A Bcon store stores one callback URL <em>per blockchain</em>. Every chain listed below must point at the same URL.
          </p>
        </div>
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

      {report?.callbackUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-void px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-accent">{report.callbackUrl}</code>
          <button
            type="button"
            onClick={copyCallbackUrl}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] hover:bg-white/5"
          >
            {copied ? <Check aria-hidden="true" className="h-3 w-3 text-emerald-300" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
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
                <th className="px-3 py-2">callback_url</th>
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
                        {chain.callbackMatchesSite ? "matches this site" : `set to ${chain.callbackUrl}`}
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
          Every chain on the store has the callback URL set.
        </p>
      )}

      {report && report.missingCallbackChains.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-200">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Bcon will reject the store form until these are filled in: {report.missingCallbackChains.map((code) => `callback_url.${code}`).join(", ")}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Bcon always keeps BTC and BNB on a store even when they are unused, so those two callback fields are validated on every save. Add the
              chains you actually accept (here: {report.expectedChain}) and you get one more required field.
            </li>
            <li>
              Open Bcon Dashboard → Merchants → your store → Settings and paste the exact URL above into <strong>every</strong> callback field the form
              shows — including the ones for chains you do not use.
            </li>
            <li>Paste the raw URL only. Markdown such as [url](url), quotes, JSON, or a trailing space all fail the same validation.</li>
            <li>If a chain field cannot be filled, unselect that blockchain so Bcon stops validating it.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
