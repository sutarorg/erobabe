"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { company_name: company, contact_name: contact },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      // Create advertiser profile
      await supabase.from("advertiser_profiles").insert({
        id: data.user.id,
        company_name: company,
        contact_name: contact,
      });

      // Profile trigger already created base profile, update it
      await supabase.from("profiles").update({
        company_name: company,
        contact_name: contact,
        role: "advertiser",
      }).eq("id", data.user.id);
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void px-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-pcard p-6 text-center">
          <h1 className="text-[18px] font-semibold">Check your email</h1>
          <p className="mt-2 text-[12px] text-ink-3">We sent a verification link to {email}. Please verify to continue.</p>
          <Link href="/auth/sign-in" className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-void px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-pcard p-6">
        <h1 className="text-[18px] font-semibold">Create advertiser account</h1>
        <p className="mt-1 text-[12px] text-ink-3">Advertise on erobabe — $99 per slot per month</p>

        <form onSubmit={handleSignUp} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Company name</span>
            <input value={company} onChange={(e) => setCompany(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="EroAds Media" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Contact name</span>
            <input value={contact} onChange={(e) => setContact(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="Alex Morgan" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="ads@company.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="Min 8 characters" />
          </label>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="h-9 w-full rounded-md bg-accent text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
            {loading ? "Creating..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-ink-3">
          Already have an account? <Link href="/auth/sign-in" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
