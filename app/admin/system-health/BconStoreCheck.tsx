"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  LoaderCircle,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import { readApiResponse } from "@/src/utils/api";

type CallbackFieldCheck = {
  code: string;
  chain: string;
  apiField: string;
  validationPath: string;
  dashboardLabel: string;
  value: string;
  actual: string | null;
  matchesExpected: boolean;
  reportedByStore: boolean;
};

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
  callbackUrlSource?: string;
  expectedChain: string;
  expectedChainCode: string;
  paymentCurrency: string;
  store: { id: string | number; name: string | null; tag: string | null } | null;
  chains: ChainCheck[];
  callbackFields: CallbackFieldCheck[];
  missingCallbackChains: string[];
  mismatchedCallbackChains: string[];
  correctiveActions: string[];
  unverified: string[];
  configWarnings: string[];
  error?: string;
};

type Probe = { ok: boolean; url: string; status: number; body?: string; error?: string };

export default function BconStoreCheck() {
  const [report, setReport] = useState<Report | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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
        callbackFields: [],
        missingCallbackChains: [],
        mismatchedCallbackChains: [],
        correctiveActions: [],
        unverified: [],
        configWarnings: [],
        error: error.message || "Could not read the Bcon store",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  async function probeCallback() {
    setProbing(true);
    setProbe(null);
    try {
      const response = await fetch("/api/admin/bcon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe-callback" }),
      });
      const json = await readApiResponse<{ probe: Probe; report: Report }>(response);
      setProbe(json.probe);
      if (json.report) setReport(json.report);
    } catch (error: any) {
      setProbe({ ok: false, url: "", status: 0, error: error.message || "Probe failed" });
    } finally {
      setProbing(false);
    }
  }

  const missing = report?.missingCallbackChains || [];
  const mismatched = report?.mismatchedCallbackChains || [];
  const allGood =
    Boolean(report?.configured) &&
    Boolean(report?.store) &&
    (report?.chains.length || 0) > 0 &&
    missing.length === 0 &&
    mismatched.length === 0;

  return (
    <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">Bcon store — per-chain callback URLs</p>
          <p className="mt-1 text-[11px] text-ink-3">
            A Bcon store keeps one callback URL per blockchain. Bcon&apos;s store form validates one callback input per blockchain and rejects a blank one with{" "}
            <code className="font-mono">The callback_url.btc must be a string.</code> — that message comes from Bcon itself, and the
            fix is to type this URL into every callback field the form shows (or disable the chain).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={probeCallback}
            disabled={loading || probing || !report?.configured}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            {probing ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <PlugZap aria-hidden="true" className="h-3.5 w-3.5" />}
            Test callback reachability
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
            Re-check store
          </button>
        </div>
      </div>

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
          API credentials{" "}
          {report.configured ? (
            <span className="text-emerald-300">configured</span>
          ) : (
            <span className="text-amber-300">missing</span>
          )}{" "}
          · Bcon API{" "}
          {report.error ? (
            <span className="text-amber-300">not verified — {report.error}</span>
          ) : report.store ? (
            <span className="text-emerald-300">reachable</span>
          ) : (
            <span className="text-ink-3">not checked</span>
          )}{" "}
          · expected chain <span className="font-mono text-ink-2">{report.expectedChain || "—"}</span> (
          <span className="font-mono text-ink-2">{report.expectedChainCode || "—"}</span>) · payment currency{" "}
          <span className="font-mono text-ink-2">{report.paymentCurrency || "—"}</span> · URL source{" "}
          <span className="font-mono text-ink-2">{report.callbackUrlSource || "—"}</span>
          {report.store ? <> · store “{report.store.name || report.store.id}”</> : null}
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
          {probe.ok
            ? `Callback endpoint answered HTTP ${probe.status} to a parameter-less probe. Bcon treats a 200 response as a successful callback delivery.`
            : `Callback endpoint probe failed${probe.status ? ` (HTTP ${probe.status})` : ""}: ${probe.error || probe.body || "no response"}`}
        </p>
      )}

      {report?.configWarnings?.map((warning) => (
        <p key={warning} className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-[11.5px] text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      ))}

      {report?.error && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-[11.5px] text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {report.error}
        </p>
      )}

      {report && report.callbackFields.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-[11.5px]">
            <thead className="border-b border-line bg-void text-[10px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2">Chain</th>
                <th className="px-3 py-2">Bcon form field</th>
                <th className="px-3 py-2">API column</th>
                <th className="px-3 py-2">Registered value</th>
              </tr>
            </thead>
            <tbody>
              {report.callbackFields.map((field) => (
                <tr key={field.code} className="border-b border-line/50">
                  <td className="px-3 py-2 capitalize">{field.chain}</td>
                  <td className="px-3 py-2 font-mono text-ink-3">{field.validationPath}</td>
                  <td className="px-3 py-2 font-mono text-ink-3">{field.apiField}</td>
                  <td className="px-3 py-2">
                    {field.actual === null ? (
                      field.reportedByStore ? (
                        <span className="text-red-300">empty — type the URL above into this field (or disable the chain)</span>
                      ) : (
                        <span className="text-ink-3">not returned by Bcon (chain not configured — unverified)</span>
                      )
                    ) : field.matchesExpected ? (
                      <span className="text-emerald-300">matches this deployment</span>
                    ) : (
                      <span className="break-all text-amber-300">set to {field.actual}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && report.chains.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-[11.5px]">
            <thead className="border-b border-line bg-void text-[10px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2">Store chain</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Chain API key</th>
                <th className="px-3 py-2">Stored callback URL</th>
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
                      <span className={chain.callbackMatchesSite ? "text-emerald-300" : "break-all text-amber-300"}>
                        {chain.callbackMatchesSite ? "matches this deployment" : chain.callbackUrl}
                      </span>
                    ) : (
                      <span className="text-red-300">empty — fill it or disable the chain</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allGood ? (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-emerald-500/10 p-3 text-[11.5px] text-emerald-200">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Every chain Bcon reports has this deployment&apos;s callback URL registered.
        </p>
      ) : null}

      {report && report.correctiveActions.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-200">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            What to do next
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {report.correctiveActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ol>
        </div>
      )}

      {report && report.unverified.length > 0 && (
        <div className="mt-3 rounded-md border border-line bg-void p-3 text-[11.5px] leading-relaxed text-ink-3">
          <p className="flex items-center gap-2 font-medium text-ink-2">
            <HelpCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Unverified — not proven by this check
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {report.unverified.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-3">
        API keys are shown only as present/missing — this panel never displays key values, wallet keys or secrets.
      </p>
    </div>
  );
}
