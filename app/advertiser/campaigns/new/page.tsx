"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Check, ImagePlus, LoaderCircle, Plus, X } from "lucide-react";

type Slot = {
  id: number;
  name: string;
  side: "left" | "right";
  position: number;
  price_cents: number;
  status: string;
  description: string | null;
  available: boolean;
};

/** Asset/network combinations the server accepts (see lib/nowpayments). */
const PAY_OPTIONS = [
  { paymentCurrency: "USDT", chain: "ethereum", label: "USDT on Ethereum" },
  { paymentCurrency: "USDT", chain: "tron", label: "USDT on Tron" },
  { paymentCurrency: "USDT", chain: "binance", label: "USDT on BNB Smart Chain" },
  { paymentCurrency: "USDT", chain: "solana", label: "USDT on Solana" },
  { paymentCurrency: "BTC", chain: "bitcoin", label: "BTC on Bitcoin" },
  { paymentCurrency: "ETH", chain: "ethereum", label: "ETH on Ethereum" },
  { paymentCurrency: "TRX", chain: "tron", label: "TRX on Tron" },
  { paymentCurrency: "BNB", chain: "binance", label: "BNB on BNB Smart Chain" },
  { paymentCurrency: "SOL", chain: "solana", label: "SOL on Solana" },
];

type PaymentState = "awaiting_payment" | "confirming" | "confirmed" | "manual_review" | "failed" | "expired" | "refunded";

function stateBanner(state: PaymentState | null): { text: string; tone: string } {
  switch (state) {
    case "confirmed":
      return { text: "Payment confirmed — your campaign moves to review/activation.", tone: "bg-emerald-500/10 text-emerald-200" };
    case "confirming":
      return { text: "Payment detected — waiting for blockchain confirmations. This page updates automatically.", tone: "bg-sky-500/10 text-sky-200" };
    case "manual_review":
      return { text: "Payment needs manual review (partial or mismatched amount). Support will reconcile it — do not pay again yet.", tone: "bg-amber-500/10 text-amber-200" };
    case "expired":
      return { text: "This payment expired before the funds arrived. Start a new checkout to get a fresh address.", tone: "bg-red-500/10 text-red-300" };
    case "failed":
      return { text: "This payment failed. Start a new checkout or contact support.", tone: "bg-red-500/10 text-red-300" };
    case "refunded":
      return { text: "This payment was refunded. Contact support if you did not expect this.", tone: "bg-amber-500/10 text-amber-200" };
    default:
      return { text: "Waiting for your payment. This page updates automatically once it is detected.", tone: "bg-white/5 text-ink-2" };
  }
}

function NewCampaignForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedSlot = Number(searchParams.get("slot"));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(1);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [payOption, setPayOption] = useState(0);
  const [paymentState, setPaymentState] = useState<PaymentState | null>(null);

  useEffect(() => {
    let current = true;
    async function loadSlots() {
      setSlotsLoading(true);
      try {
        const response = await fetch("/api/advertiser/slots", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Unable to load ad slots");
        if (!current) return;
        const nextSlots = json.slots as Slot[];
        setSlots(nextSlots);
        if (Number.isInteger(requestedSlot) && requestedSlot > 0 && nextSlots.some((slot) => slot.id === requestedSlot && slot.available)) {
          setSelectedSlotIds([requestedSlot]);
        }
      } catch (loadError: any) {
        if (current) setError(loadError.message || "Unable to load ad slots");
      } finally {
        if (current) setSlotsLoading(false);
      }
    }
    void loadSlots();
    return () => {
      current = false;
    };
  }, [requestedSlot]);

  const selectedSlots = useMemo(
    () => slots.filter((slot) => selectedSlotIds.includes(slot.id)),
    [slots, selectedSlotIds]
  );
  const totalPrice = selectedSlots.reduce((total, slot) => total + slot.price_cents * duration, 0);
  const availableSlots = slots.filter((slot) => slot.available);

  function toggleSlot(slot: Slot) {
    if (!slot.available) return;
    setSelectedSlotIds((current) =>
      current.includes(slot.id) ? current.filter((id) => id !== slot.id) : [...current, slot.id].sort((a, b) => a - b)
    );
    setError("");
  }

  function validateUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!selectedSlotIds.length) {
      setError("Select at least one available ad slot.");
      return;
    }
    if (!name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (!validateUrl(destinationUrl)) {
      setError("Enter a valid http or https destination URL.");
      return;
    }
    if (!creativeFile) {
      setError("Add a creative image.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/gif"].includes(creativeFile.type)) {
      setError("Creative must be a JPG, PNG, or GIF image.");
      return;
    }
    if (creativeFile.size > 10 * 1024 * 1024) {
      setError("Creative image must be 10 MB or smaller.");
      return;
    }

    setLoading(true);
    let campaignIds: string[] = [];
    let creativeIds: string[] = [];
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const safeName = creativeFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const objectPath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("ad-creatives")
        .upload(objectPath, creativeFile, { contentType: creativeFile.type, upsert: false });
      if (uploadError) throw new Error(`Creative upload failed: ${uploadError.message}`);

      const { data: publicData } = supabase.storage.from("ad-creatives").getPublicUrl(objectPath);
      const imageUrl = publicData.publicUrl;
      if (!imageUrl) throw new Error("Creative upload did not return an image URL");

      const { data: creatives, error: creativeError } = await supabase
        .from("ad_creatives")
        .insert(
          selectedSlotIds.map((slotId) => ({
            advertiser_id: user.id,
            slot_id: slotId,
            title: selectedSlotIds.length === 1 ? name.trim() : `${name.trim()} — Slot ${slotId}`,
            destination_url: destinationUrl.trim(),
            image_url: imageUrl,
            file_size: creativeFile.size,
            dimensions: "Creative supplied by advertiser",
            file_type: creativeFile.type,
            status: "pending",
          }))
        )
        .select("id, slot_id");
      if (creativeError || !creatives?.length) throw new Error(creativeError?.message || "Unable to create creative records");
      creativeIds = creatives.map((creative: any) => creative.id);

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + duration * 30);
      const creativeBySlot = new Map(creatives.map((creative: any) => [Number(creative.slot_id), creative.id]));
      const { data: campaigns, error: campaignError } = await supabase
        .from("campaigns")
        .insert(
          selectedSlotIds.map((slotId) => ({
            advertiser_id: user.id,
            slot_id: slotId,
            creative_id: creativeBySlot.get(slotId),
            name: selectedSlotIds.length === 1 ? name.trim() : `${name.trim()} — Slot ${slotId}`,
            start_date: startDate.toISOString().split("T")[0],
            end_date: endDate.toISOString().split("T")[0],
            status: "pending_payment",
            price_cents: (slots.find((slot) => slot.id === slotId)?.price_cents || 0) * duration,
          }))
        )
        .select("id");
      if (campaignError || !campaigns?.length) throw new Error(campaignError?.message || "Unable to create campaigns");
      campaignIds = campaigns.map((campaign: any) => campaign.id);

      const selected = PAY_OPTIONS[payOption] || PAY_OPTIONS[0];
      const response = await fetch("/api/nowpayments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignIds,
          slotIds: selectedSlotIds,
          durationMonths: duration,
          paymentCurrency: selected.paymentCurrency,
          chain: selected.chain,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.details ? `${json.error}: ${json.details}` : json.error || "Payment creation failed");

      setPaymentInfo(json);
      setPaymentState("awaiting_payment");
    } catch (submitError: any) {
      // NOWPayments only links a payment after it has successfully created an address.
      // Remove a failed browser-side draft so it does not incorrectly reserve a slot.
      if (campaignIds.length) {
        const supabase = createClient();
        await supabase.from("campaigns").delete().in("id", campaignIds);
      }
      if (creativeIds.length) {
        const supabase = createClient();
        await supabase.from("ad_creatives").delete().in("id", creativeIds);
      }
      setError(submitError.message || "Unable to create campaign");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!paymentInfo?.paymentId) return;
    let stopped = false;
    async function poll() {
      try {
        const response = await fetch(`/api/nowpayments/status?paymentId=${paymentInfo.paymentId}`, { cache: "no-store" });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json || stopped) return;
        if (typeof json.state === "string") setPaymentState(json.state as PaymentState);
        if (json.state === "confirmed" || json.state === "failed" || json.state === "expired" || json.state === "refunded") {
          stopped = true;
        }
      } catch {
        // A failed poll never breaks the screen — the next tick retries.
      }
    }
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [paymentInfo?.paymentId]);

  if (paymentInfo) {
    const banner = stateBanner(paymentState);
    return (
      <div className="max-w-xl">
        <h1 className="text-[20px] font-semibold">Complete payment</h1>
        <p className="mt-1 text-[12px] text-ink-3">Your campaign{paymentInfo.slotIds?.length > 1 ? "s are" : " is"} reserved pending payment.</p>
        <div className="mt-6 space-y-4 rounded-lg border border-line bg-pcard p-5">
          <div className={`flex items-center gap-2 rounded-md p-3 text-[11px] ${banner.tone}`}>
            {(paymentState === "awaiting_payment" || paymentState === "confirming" || !paymentState) && (
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            )}
            {banner.text}
          </div>
          <div>
            <p className="text-[11px] text-ink-3">Selected slots</p>
            <p className="mt-1 text-[14px] font-semibold">{(paymentInfo.slotIds || []).map((slotId: number) => `Slot ${slotId}`).join(", ")}</p>
          </div>
          <div>
            <p className="text-[11px] text-ink-3">Amount due</p>
            <p className="text-[18px] font-semibold">${paymentInfo.priceUSD} USD</p>
            <p className="text-[12px]">{paymentInfo.amount} {paymentInfo.paymentCurrency} on {paymentInfo.network || paymentInfo.chain}</p>
          </div>
          <div>
            <p className="text-[11px] text-ink-3">Receiving address</p>
            <p className="mt-1 break-all rounded-md bg-void p-3 font-mono text-[12px]">{paymentInfo.address}</p>
            <button type="button" onClick={() => navigator.clipboard.writeText(paymentInfo.address)} className="mt-2 h-8 rounded-md border border-line bg-card px-3 text-[11px]">Copy address</button>
          </div>
          <div className="rounded-md bg-amber-500/10 p-3 text-[11px] text-amber-200">Send exactly the displayed amount on the selected network. The campaign activates only after NOWPayments confirms the payment and the creative review completes.</div>
          <p className="text-[11px] text-ink-3">Invoice: {paymentInfo.invoiceNumber} • Expires: {new Date(paymentInfo.expiresAt).toLocaleString()}</p>
        </div>
        <button type="button" onClick={() => router.push("/advertiser/campaigns")} className="mt-5 h-9 rounded-md bg-accent px-4 text-[12px] font-semibold text-white">View campaigns</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div>
        <h1 className="text-[20px] font-semibold">New campaign</h1>
        <p className="mt-1 text-[12px] text-ink-3">Choose one or more currently available placements, then add one creative and checkout once.</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
        <section className="rounded-lg border border-line bg-pcard p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold">1. Select available ad slots</h2>
              <p className="mt-1 text-[11px] text-ink-3">Select a single slot or combine multiple slots in one campaign checkout.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelectedSlotIds(availableSlots.map((slot) => slot.id))} disabled={!availableSlots.length} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] text-ink-2 hover:bg-white/5 disabled:opacity-50">
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                All available
              </button>
              <button type="button" onClick={() => setSelectedSlotIds([])} disabled={!selectedSlotIds.length} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] text-ink-2 hover:bg-white/5 disabled:opacity-50">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          </div>

          {slotsLoading ? (
            <div className="flex h-48 items-center justify-center text-[12px] text-ink-3"><LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> Loading availability…</div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {slots.map((slot) => {
                const selected = selectedSlotIds.includes(slot.id);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => toggleSlot(slot)}
                    className={`relative rounded-lg border p-4 text-left transition ${selected ? "border-accent bg-accent/[0.08]" : slot.available ? "border-line bg-void hover:border-ink-3" : "cursor-not-allowed border-line/60 bg-void/50 opacity-50"}`}
                  >
                    <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded border ${selected ? "border-accent bg-accent text-white" : "border-line"}`}>
                      {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                    </span>
                    <p className="pr-7 text-[12px] font-semibold">Slot {slot.id} — {slot.name}</p>
                    <p className="mt-1 text-[10.5px] text-ink-3">{slot.side} rail · position {slot.position}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[12px] font-semibold">${(slot.price_cents / 100).toFixed(2)}/mo</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${slot.available ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-ink-3"}`}>{slot.available ? "Available" : "Unavailable"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {!slotsLoading && !slots.length && <p className="mt-5 rounded-md border border-dashed border-line p-5 text-center text-[12px] text-ink-3">No ad slots are configured yet.</p>}
        </section>

        <section className="rounded-lg border border-line bg-pcard p-5">
          <div>
            <h2 className="text-[14px] font-semibold">2. Campaign details</h2>
            <p className="mt-1 text-[11px] text-ink-3">One creative will be submitted for each selected slot.</p>
          </div>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Campaign name *</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} placeholder="e.g. Winter launch" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Duration *</span>
              <select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
                <option value={1}>1 month</option>
                <option value={2}>2 months</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Payment asset & network *</span>
              <select value={payOption} onChange={(event) => setPayOption(Number(event.target.value))} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
                {PAY_OPTIONS.map((option, index) => (
                  <option key={`${option.paymentCurrency}-${option.chain}`} value={index}>{option.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-[10.5px] text-ink-3">Pay with crypto via NOWPayments. Send exactly the quoted amount on this network.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Destination URL *</span>
              <input type="url" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} required placeholder="https://your-landing-page.com" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Creative image * <span className="font-normal text-ink-3">(JPG, PNG, GIF · max 10 MB)</span></span>
              <span className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-void px-3 text-center hover:border-ink-3">
                <ImagePlus aria-hidden="true" className="h-5 w-5 text-ink-3" />
                <span className="mt-2 text-[11px] text-ink-2">{creativeFile ? creativeFile.name : "Choose a creative image"}</span>
                {creativeFile && <span className="mt-1 text-[10px] text-ink-3">{(creativeFile.size / 1024 / 1024).toFixed(2)} MB</span>}
                <input type="file" accept="image/jpeg,image/png,image/gif" required onChange={(event) => setCreativeFile(event.target.files?.[0] || null)} className="sr-only" />
              </span>
            </label>
          </div>

          <div className="mt-5 rounded-md bg-void p-3">
            <div className="flex items-center justify-between text-[11px] text-ink-3"><span>Selected slots</span><span>{selectedSlotIds.length}</span></div>
            <p className="mt-1 text-[13px] font-semibold">{selectedSlots.length ? selectedSlots.map((slot) => `Slot ${slot.id}`).join(", ") : "No slots selected"}</p>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3"><span className="text-[11px] text-ink-3">Total for {duration} month{duration > 1 ? "s" : ""}</span><span className="text-[15px] font-semibold">${(totalPrice / 100).toFixed(2)}</span></div>
          </div>

          {error && <p className="mt-4 rounded-md bg-red-500/10 p-3 text-[12px] text-red-400">{error}</p>}
          <button type="submit" disabled={loading || slotsLoading || !selectedSlotIds.length} className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50">
            {loading && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {loading ? "Creating checkout..." : "Create campaign & payment"}
          </button>
        </section>
      </form>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[12px] text-ink-3">Loading…</div>}>
      <NewCampaignForm />
    </Suspense>
  );
}
