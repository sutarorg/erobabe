"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
export default function UpdatePassword() {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-void p-4">
      <div className="w-full max-w-sm rounded border border-line bg-pcard p-6">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        {!done && (
          <form
            className="mt-5 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setMessage("");
              if (password !== confirm) {
                setMessage("Passwords must match.");
                return;
              }
              setBusy(true);
              try {
                const db = createClient();
                const {
                  data: { user },
                } = await db.auth.getUser();
                if (!user)
                  throw new Error(
                    "Recovery session expired. Request a new reset link.",
                  );
                const { error } = await db.auth.updateUser({ password });
                if (error) throw error;
                await db.auth.signOut();
                setDone(true);
                setMessage("Password updated. Sign in with your new password.");
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "Unable to update password.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block text-sm">
              New password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded bg-void p-2"
              />
            </label>
            <label className="block text-sm">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded bg-void p-2"
              />
            </label>
            <button
              disabled={busy}
              className="rounded bg-accent px-4 py-2 text-sm"
            >
              {busy ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
        {message && (
          <p role="status" className="my-4 text-sm">
            {message}
          </p>
        )}
        <Link href="/auth/sign-in" className="mt-4 block text-sm text-accent">
          Sign in
        </Link>
      </div>
    </main>
  );
}
