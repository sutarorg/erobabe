import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Check, Copy, Download, KeyRound, Loader2,
  RefreshCw, ShieldAlert, ShieldCheck, Smartphone,
} from "lucide-react";
import { api } from "./api";
import { Btn, EmptyBlock, Field, Input, PageHeader, Spinner, useFetch, fmtDateTime } from "./ui";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

/** Renders the otpauth URI as a scannable QR code. */
function QRCode({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const QR = (await import("qrcode")).default;
        if (cancelled || !ref.current) return;
        await QR.toCanvas(ref.current, value, {
          width: 208,
          margin: 1,
          color: { dark: "#050506", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) {
    return (
      <div className="grid size-52 place-items-center rounded-xl bg-white/5 p-4 text-center text-[11px] text-fog-500">
        Couldn't render the QR code — enter the setup key manually instead.
      </div>
    );
  }
  return <canvas ref={ref} className="size-52 rounded-xl bg-white p-2" aria-label="Two-factor QR code" />;
}

/** One-time display of recovery codes, with copy and download. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast("Recovery codes copied");
      setSaved(true);
    } catch {
      toast("Copy failed — download them instead", "info");
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        "EroBabe — two-factor recovery codes\n",
        "Each code can be used once. Store them somewhere safe and offline.\n\n",
        codes.map((c, i) => `${String(i + 1).padStart(2, "0")}. ${c}`).join("\n"),
        "\n",
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "erobabe-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-5">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-100">Save your recovery codes</h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
            These are shown <span className="font-semibold">once only</span>. Each works a single time
            and lets you sign in if you lose your authenticator device.
          </p>

          <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-2">
            {codes.map((c) => (
              <li key={c} className="rounded-lg bg-black/30 px-3 py-2 text-center tracking-wider text-amber-100">
                {c}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn size="sm" variant="subtle" icon={Copy} onClick={copyAll}>Copy all</Btn>
            <Btn size="sm" variant="subtle" icon={Download} onClick={download}>Download</Btn>
            <Btn size="sm" variant="primary" icon={Check} onClick={onDone} disabled={!saved}>
              {saved ? "I've saved them" : "Save them first"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Security() {
  const status = useFetch(() => api.twoFactorStatus(), []);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disarming, setDisarming] = useState(false);

  const reset = useCallback(() => {
    setSetup(null);
    setCode("");
    setPassword("");
    setError(null);
    setDisarming(false);
    status.reload();
  }, [status]);

  if (status.loading) return <Spinner label="Loading security settings…" />;
  if (status.error || !status.data) {
    return <EmptyBlock icon={ShieldAlert} title="Couldn't load security settings" body={status.error ?? undefined} />;
  }

  const { enabled, enrolledAt, recoveryRemaining, account } = status.data;

  const beginSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.twoFactorSetup();
      setSetup({ secret: res.secret, otpauth: res.otpauth });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.twoFactorEnable(code.trim());
      setRecovery(res.recoveryCodes);
      setSetup(null);
      setCode("");
      toast("Two-factor authentication enabled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.twoFactorDisable(password, code.trim());
      toast("Two-factor authentication disabled", "info");
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.twoFactorRecoveryCodes(code.trim());
      setRecovery(res.recoveryCodes);
      setCode("");
      toast("New recovery codes generated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not regenerate codes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Security" sub="Protect the admin panel with a second authentication factor." />

      {recovery && <RecoveryCodes codes={recovery} onDone={() => { setRecovery(null); reset(); }} />}

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/8 p-3 text-xs text-red-300" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {!recovery && (
        <section className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          {/* Current state */}
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl",
                enabled ? "bg-emerald-500/12 text-emerald-300" : "bg-amber-500/12 text-amber-300"
              )}
            >
              {enabled ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldAlert className="size-5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-white">
                Two-factor authentication is {enabled ? "on" : "off"}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-fog-500">
                {enabled
                  ? `Enabled ${fmtDateTime(enrolledAt)} · ${recoveryRemaining} recovery code${recoveryRemaining === 1 ? "" : "s"} remaining. A code from your authenticator is required at every sign-in.`
                  : "Anyone with the password can currently reach the CMS. Add an authenticator app for a second layer of protection."}
              </p>
            </div>
          </div>

          {/* ── Enrollment ── */}
          {!enabled && !setup && (
            <div className="mt-5 border-t border-white/6 pt-5">
              <Btn variant="primary" icon={Smartphone} busy={busy} onClick={beginSetup}>
                Set up authenticator app
              </Btn>
            </div>
          )}

          {!enabled && setup && (
            <div className="mt-5 space-y-4 border-t border-white/6 pt-5">
              <div>
                <p className="text-xs font-semibold text-white">1. Scan this code</p>
                <p className="mt-0.5 text-[11px] text-fog-500">
                  Use Google Authenticator, 1Password, Authy, Bitwarden or any TOTP app.
                </p>
                <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  <QRCode value={setup.otpauth} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-fog-600">
                      Or enter this key manually
                    </p>
                    <code className="mt-1.5 block break-all rounded-lg bg-ink-850 px-3 py-2 font-mono text-xs text-brand-200">
                      {setup.secret}
                    </code>
                    <p className="mt-2 text-[11px] text-fog-600">Account: {account} · Issuer: EroBabe</p>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(setup.secret).catch(() => {});
                        toast("Setup key copied");
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-300 hover:text-brand-400"
                    >
                      <Copy className="size-3" aria-hidden /> Copy key
                    </button>
                  </div>
                </div>
              </div>

              <Field label="2. Enter the 6-digit code to confirm">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="text-center text-base tracking-[0.3em]"
                />
              </Field>

              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => { setSetup(null); setCode(""); }}>Cancel</Btn>
                <Btn variant="primary" busy={busy} disabled={code.trim().length !== 6} onClick={confirmSetup}>
                  Verify & enable
                </Btn>
              </div>
            </div>
          )}

          {/* ── Management ── */}
          {enabled && !disarming && (
            <div className="mt-5 space-y-4 border-t border-white/6 pt-5">
              <Field
                label="Generate new recovery codes"
                hint="Enter a current authenticator code. Existing codes stop working immediately."
              >
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                  <Btn variant="subtle" icon={RefreshCw} busy={busy} disabled={code.trim().length !== 6} onClick={regenerate}>
                    Regenerate
                  </Btn>
                </div>
              </Field>
              <div className="border-t border-white/6 pt-4">
                <Btn variant="ghost" className="!text-red-400 hover:!bg-red-500/10" onClick={() => { setDisarming(true); setCode(""); }}>
                  Disable two-factor authentication
                </Btn>
              </div>
            </div>
          )}

          {enabled && disarming && (
            <div className="mt-5 space-y-4 border-t border-white/6 pt-5">
              <p className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/8 p-3 text-xs text-red-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Turning this off leaves the CMS protected by the password alone. Confirm with both your
                password and a current code.
              </p>
              <Field label="Account password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="Authenticator or recovery code">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" autoComplete="one-time-code" />
              </Field>
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => { setDisarming(false); setPassword(""); setCode(""); }}>Cancel</Btn>
                <Btn variant="danger" busy={busy} disabled={!password || !code.trim()} onClick={disable}>
                  Disable 2FA
                </Btn>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="mt-4 rounded-2xl border border-white/6 bg-ink-900/40 p-4 text-[11px] leading-relaxed text-fog-600">
        <Loader2 className="mr-1 inline size-3 align-[-2px]" aria-hidden />
        Codes are verified server-side against a secret encrypted at rest. Attempts are rate-limited,
        each code can only be used once, and a password-only session can never reach the CMS or any
        admin API.
      </p>
    </div>
  );
}
