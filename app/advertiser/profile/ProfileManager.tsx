"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle, Eye, EyeOff, LoaderCircle, Save, Trash2 } from "lucide-react";

type ProfileValues = {
  displayName: string;
  companyName: string;
  contactName: string;
  website: string;
  country: string;
};

export default function ProfileManager({ email, initialValues }: { email: string; initialValues: ProfileValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved">("idle");
  const [profileError, setProfileError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordState, setPasswordState] = useState<"idle" | "saving" | "saved">("idle");
  const [passwordError, setPasswordError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function updateValue(key: keyof ProfileValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setProfileState("idle");
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileState("saving");
    setProfileError("");
    try {
      const response = await fetch("/api/advertiser/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to update profile");
      setProfileState("saved");
    } catch (error: any) {
      setProfileError(error.message || "Unable to update profile");
      setProfileState("idle");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError("");
    setPasswordState("idle");
    if (password.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordState("saving");
    try {
      const response = await fetch("/api/advertiser/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to change password");
      setPassword("");
      setConfirmPassword("");
      setPasswordState("saved");
    } catch (error: any) {
      setPasswordError(error.message || "Unable to change password");
      setPasswordState("idle");
    }
  }

  async function deleteAccount() {
    setDeleteError("");
    if (deleteConfirmation !== "DELETE") {
      setDeleteError("Type DELETE exactly to confirm.");
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch("/api/advertiser/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to delete account");
      await createClient().auth.signOut();
      router.replace("/");
      router.refresh();
    } catch (error: any) {
      setDeleteError(error.message || "Unable to delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div>
        <h1 className="text-[20px] font-semibold">Profile</h1>
        <p className="mt-1 text-[12px] text-ink-3">Manage your advertiser details, password, and account.</p>
      </div>

      <form onSubmit={saveProfile} className="mt-6 rounded-lg border border-line bg-pcard p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">Advertiser details</h2>
            <p className="mt-1 text-[11px] text-ink-3">Your sign-in email is managed by your authentication provider.</p>
          </div>
          {profileState === "saved" && <span className="text-[11px] text-emerald-300">Saved</span>}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Email</span>
            <input value={email} readOnly className="h-9 w-full cursor-not-allowed rounded-md border border-line bg-white/[0.03] px-3 text-[13px] text-ink-3" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Display name</span>
            <input value={values.displayName} onChange={(event) => updateValue("displayName", event.target.value)} maxLength={80} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="How we should address you" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Company name *</span>
            <input value={values.companyName} onChange={(event) => updateValue("companyName", event.target.value)} required minLength={2} maxLength={160} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Contact name</span>
            <input value={values.contactName} onChange={(event) => updateValue("contactName", event.target.value)} maxLength={160} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Website</span>
            <input value={values.website} onChange={(event) => updateValue("website", event.target.value)} maxLength={500} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="https://example.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Country</span>
            <input value={values.country} onChange={(event) => updateValue("country", event.target.value)} maxLength={100} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
          </label>
        </div>
        {profileError && <p className="mt-4 rounded-md bg-red-500/10 p-3 text-[12px] text-red-400">{profileError}</p>}
        <button type="submit" disabled={profileState === "saving"} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[12px] font-semibold text-white disabled:opacity-50">
          {profileState === "saving" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="h-4 w-4" />}
          {profileState === "saving" ? "Saving..." : "Save profile"}
        </button>
      </form>

      <form onSubmit={changePassword} className="mt-5 rounded-lg border border-line bg-pcard p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">Change password</h2>
            <p className="mt-1 text-[11px] text-ink-3">Use a new password with at least 8 characters.</p>
          </div>
          {passwordState === "saved" && <span className="text-[11px] text-emerald-300">Password updated</span>}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">New password</span>
            <span className="relative block">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setPasswordState("idle"); }} minLength={8} autoComplete="new-password" className="h-9 w-full rounded-md border border-line bg-void px-3 pr-10 text-[13px]" />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-3 hover:text-ink">
                {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
              </button>
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Confirm new password</span>
            <input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordState("idle"); }} minLength={8} autoComplete="new-password" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
          </label>
        </div>
        {passwordError && <p className="mt-4 rounded-md bg-red-500/10 p-3 text-[12px] text-red-400">{passwordError}</p>}
        <button type="submit" disabled={passwordState === "saving"} className="mt-5 inline-flex h-9 items-center rounded-md border border-line bg-card px-4 text-[12px] font-semibold text-ink hover:bg-card-hover disabled:opacity-50">
          {passwordState === "saving" ? "Updating..." : "Update password"}
        </button>
      </form>

      <section className="mt-5 rounded-lg border border-red-500/30 bg-red-500/[0.04] p-5">
        <div className="flex gap-3">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <h2 className="text-[14px] font-semibold text-red-100">Delete account</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-red-100/70">This permanently deletes your advertiser account and its associated campaigns, creatives, invoices, and payment records where database retention rules permit. This cannot be undone.</p>
          </div>
        </div>
        <label className="mt-4 block max-w-sm">
          <span className="mb-1 block text-[11px] font-medium text-red-100/80">Type DELETE to confirm</span>
          <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="h-9 w-full rounded-md border border-red-500/30 bg-void px-3 text-[13px]" placeholder="DELETE" />
        </label>
        {deleteError && <p className="mt-3 rounded-md bg-red-500/10 p-3 text-[12px] text-red-300">{deleteError}</p>}
        <button type="button" onClick={deleteAccount} disabled={deleting || deleteConfirmation !== "DELETE"} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-red-500/40 px-4 text-[12px] font-semibold text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          {deleting ? "Deleting account..." : "Delete account permanently"}
        </button>
      </section>
    </div>
  );
}
