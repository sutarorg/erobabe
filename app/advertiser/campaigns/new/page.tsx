"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";

function NewCampaignForm() {
  const searchParams = useSearchParams();
  const initialSlot = searchParams.get("slot");
  const router = useRouter();

  const [slots, setSlots] = useState<any[]>([]);
  const [slotId, setSlotId] = useState<number>(initialSlot ? parseInt(initialSlot) : 1);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(1);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [creativeTitle, setCreativeTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentInfo, setPaymentInfo] = useState<any>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("ad_slots").select("*").order("id").then(({ data }) => setSlots(data || []));
  }, []);

  const validateUrl = (url: string) => {
    try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Campaign name required"); return; }
    if (!validateUrl(destinationUrl)) { setError("Valid destination URL required (https)"); return; }
    if (creativeFile) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(creativeFile.type)) { setError("Creative must be JPG, PNG, or WebP"); return; }
      if (creativeFile.size > 5 * 1024 * 1024) { setError("Creative max 5MB"); return; }
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let imageUrl: string | null = null;
      if (creativeFile) {
        const fileName = `${user.id}/${Date.now()}-${creativeFile.name}`;
        const { error: uploadError } = await supabase.storage.from("ad-creatives").upload(fileName, creativeFile);
        if (uploadError) {
          console.warn("Storage upload failed", uploadError);
        } else {
          const { data } = supabase.storage.from("ad-creatives").getPublicUrl(fileName);
          imageUrl = data.publicUrl;
        }
      }

      const { data: creative, error: creativeError } = await supabase.from("ad_creatives").insert({
        advertiser_id: user.id,
        slot_id: slotId,
        title: creativeTitle || name,
        destination_url: destinationUrl,
        image_url: imageUrl,
        file_size: creativeFile?.size,
        dimensions: "1200x675 (16:9)",
        file_type: creativeFile?.type,
        status: "pending",
      }).select().single();

      if (creativeError) throw creativeError;

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + duration * 30);

      const { data: campaign, error: campaignError } = await supabase.from("campaigns").insert({
        advertiser_id: user.id,
        slot_id: slotId,
        creative_id: creative.id,
        name: name.trim(),
        start_date: startDate.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        status: "pending_payment",
        price_cents: 9900 * duration,
      }).select().single();

      if (campaignError) throw campaignError;

      const res = await fetch("/api/bcon/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.id,
          slotId,
          creativeId: creative.id,
          durationMonths: duration,
          paymentCurrency: "USDT",
          chain: "ethereum",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Payment creation failed");

      setPaymentInfo(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (paymentInfo) {
    return (
      <div className="max-w-xl">
        <h1 className="text-[20px] font-semibold">Complete Payment</h1>
        <p className="mt-1 text-[12px] text-ink-3">Campaign created — pending payment. Scan QR or copy address.</p>

        <div className="mt-6 rounded-lg border border-line bg-pcard p-5 space-y-4">
          <div><p className="text-[11px] text-ink-3">Amount due</p><p className="text-[18px] font-semibold">${paymentInfo.priceUSD} USD</p><p className="text-[12px]">{paymentInfo.amount} {paymentInfo.paymentCurrency} on {paymentInfo.chain}</p></div>
          <div><p className="text-[11px] text-ink-3">Receiving address</p><p className="mt-1 break-all rounded-md bg-void p-3 font-mono text-[12px]">{paymentInfo.address}</p><button type="button" onClick={() => navigator.clipboard.writeText(paymentInfo.address)} className="mt-2 h-8 rounded-md border border-line bg-card px-3 text-[11px]">Copy address</button></div>
          <div className="rounded-md bg-amber-500/10 p-3 text-[11px] text-amber-200">Choose correct network ({paymentInfo.chain}) and token ({paymentInfo.paymentCurrency}). Payment requires confirmed status (2 confirmations) before activation.</div>
          <p className="text-[11px] text-ink-3">Invoice: {paymentInfo.invoiceNumber} • Expires: {new Date(paymentInfo.expiresAt).toLocaleString()}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-[20px] font-semibold">New Campaign</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real campaign creation with Bcon crypto payment, $99/month, creative review required.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-line bg-pcard p-5">
        <label className="block"><span className="mb-1 block text-[11px]">Slot *</span>
          <select value={slotId} onChange={(e) => setSlotId(parseInt(e.target.value))} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
            {slots.map((s) => <option key={s.id} value={s.id}>Slot {s.id} — {s.name} — ${(s.price_cents / 100).toFixed(2)}/mo</option>)}
          </select>
        </label>

        <label className="block"><span className="mb-1 block text-[11px]">Campaign name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Velvet Nights — December Push" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
        </label>

        <label className="block"><span className="mb-1 block text-[11px]">Duration (months) *</span>
          <select value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
            <option value={1}>1 month — $99</option>
            <option value={2}>2 months — $198</option>
            <option value={3}>3 months — $297</option>
          </select>
        </label>

        <label className="block"><span className="mb-1 block text-[11px]">Destination URL * (safe https)</span>
          <input value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} required placeholder="https://your-landing-page.com" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
        </label>

        <label className="block"><span className="mb-1 block text-[11px]">Creative title</span>
          <input value={creativeTitle} onChange={(e) => setCreativeTitle(e.target.value)} placeholder="Winter Push — Banner v1" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
        </label>

        <label className="block"><span className="mb-1 block text-[11px]">Creative image (16:9, 1200×675, JPG/PNG/WebP, max 5MB)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCreativeFile(e.target.files?.[0] || null)} className="w-full rounded-md border border-dashed border-line bg-void p-3 text-[12px]" />
        </label>

        {error && <p className="rounded-md bg-red-500/10 p-3 text-[12px] text-red-400">{error}</p>}

        <button type="submit" disabled={loading} className="inline-flex h-9 items-center rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
          {loading ? "Creating..." : "Create campaign & get payment address"}
        </button>
      </form>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[12px] text-ink-3">Loading...</div>}>
      <NewCampaignForm />
    </Suspense>
  );
}
