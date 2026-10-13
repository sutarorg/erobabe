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

type Report = {
  apiKeyConfigured: boolean;
  apiReachable: boolean;
  apiStatus: number;
  apiMessage: string;
  ipnSecretConfigured: boolean;
  ipnUrl: string;
  ipnUrlSource?: string;
  defaultPayCurrency: string;
  defaultPayCurrencyValid: boolean;
  supportedPayCurrencies: string[];
  unavailableCurrencies: string[];
  currenciesChecked: boolean;
  correctiveActions: string[];
  configWarnings: string[];
  error?: string;
};

type Probe = { ok: boolean; url: string; status: number; body?: string; error?: string };

export default function NowpaymentsCheck() {
  const [report, setReport] = useState<Report | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/nowpayments", { cache: "no-store" });
      setReport(await readApiResponse<Report>(response));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not read the NOWPayments setup";
      setReport({
        apiKeyConfigured: false,
        apiReachable: false,
        apiStatus: 0,
        apiMessage: "",
        ipnSecretConfigured: false,
        ipnUrl: "",
        defaultPayCurrency: "",
        defaultPayCurrencyValid: false,
        supportedPayCurrencies: [],
        unavailableCurrencies: [],
        currenciesChecked: false,
        correctiveActions: [],
        configWarnings: [],
        error: message,
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

  async function probeIpn() {
    setProbing(true);
    setProbe(null);
    try {
      const response = await fetch("/api/admin/nowpayments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe-ipn" }),
      });
      const json = await readApiResponse<{ probe: Probe; report: Report }>(response);
      setProbe(json.probe);
      if (json.report) setReport(json.report);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Probe failed";
      setProbe({ ok: false, url: "", status: 0, error: message });
    } finally {
      setProbing(false);
    }
  }

  const allGood =
    Boolean(report?.apiKeyConfigured) &&
    Boolean(report?.apiReachable) &&
    Boolean(report?.ipnSecretConfigured) &&
    !report?.error &&
    (report?.configWarnings.length || 0) === 0;

  return (
    <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">NOWPayments — API & IPN configuration</p>
          <p className="mt-1 text-[11px] text-ink-3">
            Every payment sends the IPN URL below to NOWPayments, which POSTs a signed notification whenever the
            payment status changes. Only a verified <code className="font-mono">finished</code> status marks a
            payment paid — intermediate states never fulfill a campaign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={probeIpn}
            disabled={loading || probing || !report?.ipnUrl}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            {probing ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <PlugZap aria-hidden="true" className="h-3.5 w-3.5" />}
            Test IPN reachability
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

      {report?.ipnUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-void px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink-2">{report.ipnUrl}</code>
          <button
            type="button"
            onClick={() => copyText("url", report.ipnUrl)}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] hover:bg-white/5"
          >
            {copied === "url" ? <Check aria-hidden="true" className="h-3 w-3 text-emerald-300" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
            {copied === "url" ? "Copied" : "Copy URL"}
          </button>
        </div>
      )}

      {report && (
        <p className="mt-2 text-[11px] text-ink-3">
          API key{" "}
          {report.apiKeyConfigured ? (
            <span className="text-emerald-300">configured</span>
          ) : (
            <span className="text-amber-300">missing</span>
          )}{" "}
          · NOWPayments API{" "}
          {report.error ? (
            <span className="text-amber-300">not verified — {report.error}</span>
          ) : report.apiReachable ? (
            <span className="text-emerald-300">reachable</span>
          ) : (
            <span className="text-ink-3">not checked</span>
          )}{" "}
          · IPN secret{" "}
          {report.ipnSecretConfigured ? (
            <span className="text-emerald-300">configured</span>
          ) : (
            <span className="text-amber-300">missing</span>
          )}{" "}
          · default pay currency{" "}
          <span className="font-mono text-ink-2">{report.defaultPayCurrency || "—"}</span> · URL source{" "}
          <span className="font-mono text-ink-2">{report.ipnUrlSource || "—"}</span>
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
            ? `IPN endpoint answered HTTP ${probe.status} to a parameter-less probe. NOWPayments retries notifications that do not answer 200.`
            : `IPN endpoint probe failed${probe.status ? ` (HTTP ${probe.status})` : ""}: ${probe.error || probe.body || "no response"}`}
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

      {report && report.supportedPayCurrencies.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-[11.5px]">
            <thead className="border-b border-line bg-void text-[10px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2">Pay currency</th>
                <th className="px-3 py-2">NOWPayments availability</th>
              </tr>
            </thead>
            <tbody>
              {report.supportedPayCurrencies.map((currency) => {
                const unavailable = report.unavailableCurrencies.includes(currency);
                return (
                  <tr key={currency} className="border-b border-line/50">
                    <td className="px-3 py-2 font-mono">{currency}</td>
                    <td className="px-3 py-2">
                      {!report.currenciesChecked ? (
                        <span className="text-ink-3">not checked</span>
                      ) : unavailable ? (
                        <span className="text-amber-300">not listed by NOWPayments right now</span>
                      ) : (
                        <span className="text-emerald-300">listed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {allGood ? (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-emerald-500/10 p-3 text-[11.5px] text-emerald-200">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          NOWPayments API credentials verify, the IPN secret is set, and the callback URL is configured.
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

      {report && !report.ipnSecretConfigured && (
        <div className="mt-3 rounded-md border border-line bg-void p-3 text-[11.5px] leading-relaxed text-ink-3">
          <p className="flex items-center gap-2 font-medium text-ink-2">
            <HelpCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Unverified — not proven by this check
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>IPN delivery itself can only be proven by a real signed notification reaching the URL above.</li>
            <li>Payment creation can only be proven by a genuine (minimum-amount) test payment.</li>
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-3">
        API keys and the IPN secret are shown only as present/missing — this panel never displays key values, wallet keys or secrets.
      </p>
    </div>
  );
}
