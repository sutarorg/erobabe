import { Lock, Mail, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { LOGO_URL } from "../data/content";

interface SignInModalProps {
  onClose: () => void;
  onSignIn: (name: string) => void;
}

const inputClass =
  "flex h-9 w-full items-center rounded-md border border-line bg-card px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent/60";

export default function SignInModal({ onClose, onSignIn }: SignInModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = email.split("@")[0]?.trim() || "Member";
    onSignIn(name.charAt(0).toUpperCase() + name.slice(1));
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <div
        className="eb-backdrop absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to erobabe"
          className="eb-panel relative w-full max-w-[340px] rounded-xl border border-line bg-panel p-6 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in"
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-card hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>

          <div className="flex flex-col items-center">
            <img src={LOGO_URL} alt="erobabe logo" className="h-10 w-auto object-contain" />
            <h2 className="mt-3 text-[16px] font-semibold tracking-tight text-ink">
              Welcome back
            </h2>
            <p className="mt-1 text-center text-[12px] leading-relaxed text-ink-3">
              Demo only — authentication is not connected. Any details will work.
            </p>
          </div>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="sr-only">Email address</span>
              <span className="relative block">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
                  aria-hidden
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className={inputClass + " pl-9"}
                />
              </span>
            </label>
            <label className="block">
              <span className="sr-only">Password</span>
              <span className="relative block">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
                  aria-hidden
                />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className={inputClass + " pl-9"}
                />
              </span>
            </label>
            <button
              type="submit"
              className="h-9 w-full rounded-md bg-accent text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              Sign In
            </button>
          </form>

          <p className="mt-4 text-center text-[11.5px] text-ink-3">
            New to erobabe?{" "}
            <button
              type="button"
              onClick={() => onSignIn("Member")}
              className="font-medium text-accent transition-colors hover:text-accent-soft"
            >
              Create a demo account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
