import {
  ArrowLeft, ArrowRight, Check, CircleCheck, ImagePlus, Lock, TriangleAlert, Wallet, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../utils/cn";
import { fmtUSD, SLOT_PRICE, type Slot } from "./data";
import type { PortalView } from "./Sidebar";
import { Btn, Card, Field, PageHeader, Select } from "./ui";

export interface NewCampaignPayload {
  name: string;
  slotId: number;
  months: number;
  url: string;
  creativeName?: string;
  creativePreview?: string;
}

interface CreateCampaignViewProps {
  slots: Slot[];
  wallet: number;
  onSubmit: (payload: NewCampaignPayload) => void;
  onNavigate: (view: PortalView) => void;
  onAddFunds: () => void;
}

type Step = "form" | "review" | "success";

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 py-2.5 text-[12px] last:border-0">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

export default function CreateCampaignView({
  slots,
  wallet,
  onSubmit,
  onNavigate,
  onAddFunds,
}: CreateCampaignViewProps) {
  const available = useMemo(() => slots.filter((s) => s.status === "available"), [slots]);

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [slotId, setSlotId] = useState<number | "">("");
  const [months, setMonths] = useState(1);
  const [url, setUrl] = useState("");
  const [creative, setCreative] = useState<{ name: string; preview: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const slot = available.find((s) => s.id === slotId);
  const total = SLOT_PRICE * months;
  const sufficient = wallet >= total;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setCreative({ name: file.name, preview: URL.createObjectURL(file) });
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (name.trim().length < 3) next.name = "Enter at least 3 characters.";
    if (!slotId) next.slot = "Select an available ad slot.";
    if (!/^https?:\/\/.+\..+/.test(url.trim())) next.url = "Enter a valid URL starting with https://";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const reset = () => {
    setStep("form");
    setName("");
    setSlotId("");
    setMonths(1);
    setUrl("");
    setCreative(null);
    setErrors({});
  };

  return (
    <div>
      <PageHeader
        title="Create Campaign"
        sub="Reserve a placement, upload a creative and go live within 24 hours."
      />

      {step === "success" ? (
        <Card className="mx-auto mt-10 max-w-md p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <CircleCheck className="h-6 w-6 text-emerald-400" aria-hidden />
          </span>
          <h2 className="mt-3 text-[16px] font-semibold text-ink">Campaign submitted</h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
            “{name}” is pending review for Slot {slotId}. This is a demo — the reservation exists
            only in local state and no payment was processed.
          </p>
          <div className="mt-4 rounded-lg border border-line bg-pcard px-3.5 text-left">
            <SummaryRow label="Placement" value={slot?.name ?? `Slot ${slotId}`} />
            <SummaryRow label="Duration" value={`${months} month${months > 1 ? "s" : ""}`} />
            <SummaryRow label="Charged to wallet" value={fmtUSD(total)} />
          </div>
          <div className="mt-4 flex gap-2">
            <Btn variant="outline" className="flex-1" onClick={reset}>
              Create another
            </Btn>
            <Btn className="flex-1" onClick={() => onNavigate("campaigns")}>
              View My Campaigns
            </Btn>
          </div>
        </Card>
      ) : (
        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.7fr_1fr]">
          {/* form */}
          <Card className="p-5">
            {step === "form" ? (
              <div className="space-y-4">
                <Field
                  label="Campaign name"
                  placeholder="e.g. Velvet Nights — December Push"
                  value={name}
                  error={errors.name}
                  onChange={(e) => setName(e.target.value)}
                />

                {/* Visual slot picker — mirrors the live rail layout.
                    Occupied placements are dimmed and non-interactive. */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11.5px] font-medium text-ink-2">Ad slot</span>
                    <span className="flex items-center gap-3 text-[10px] text-ink-3">
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> Available
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" aria-hidden /> Taken
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-void p-3">
                    {(["left", "right"] as const).map((side) => (
                      <div key={side}>
                        <p className="mb-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-3">
                          {side} rail
                        </p>
                        <div className="space-y-2">
                          {slots
                            .filter((s) => s.side === side)
                            .map((s) => {
                              const taken = s.status !== "available";
                              const selected = slotId === s.id;
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  disabled={taken}
                                  aria-pressed={selected}
                                  aria-label={
                                    taken
                                      ? `Slot ${s.id}, ${s.name} — unavailable`
                                      : `Select slot ${s.id}, ${s.name}`
                                  }
                                  onClick={() => {
                                    setSlotId(s.id);
                                    setErrors((e) => ({ ...e, slot: "" }));
                                  }}
                                  className={cn(
                                    "group relative flex aspect-video w-full flex-col items-center justify-center rounded-md border transition-all duration-150",
                                    taken
                                      ? "cursor-not-allowed border-line bg-pcard opacity-40"
                                      : selected
                                        ? "border-accent bg-accent/12 ring-1 ring-accent/40"
                                        : "border-accent/30 bg-pcard-2 hover:border-accent/70 hover:bg-accent/[0.07]"
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "absolute left-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-semibold tabular-nums",
                                      taken ? "bg-white/5 text-ink-3" : "bg-accent/15 text-accent"
                                    )}
                                  >
                                    {s.id}
                                  </span>
                                  {selected && (
                                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
                                      <Check className="h-2.5 w-2.5" aria-hidden />
                                    </span>
                                  )}
                                  {taken && (
                                    <Lock className="absolute right-1.5 top-1.5 h-3 w-3 text-ink-3" aria-hidden />
                                  )}
                                  <span
                                    className={cn(
                                      "px-1 text-center text-[9.5px] font-medium leading-tight",
                                      taken ? "text-ink-3" : selected ? "text-ink" : "text-zinc-300"
                                    )}
                                  >
                                    {s.name.replace(/^(Left|Right) Sidebar ?/, "") || "Top"}
                                  </span>
                                  <span
                                    className={cn(
                                      "mt-0.5 text-[8.5px] font-medium tracking-[0.1em]",
                                      taken ? "text-ink-3" : "text-accent"
                                    )}
                                  >
                                    {taken ? "TAKEN" : "16:9"}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-3">
                      {slot
                        ? `Selected: Slot ${slot.id} · ${slot.name} — ${fmtUSD(SLOT_PRICE)}/mo`
                        : `${available.length} of ${slots.length} placements available`}
                    </span>
                    {errors.slot && <span className="text-[11px] text-red-400">{errors.slot}</span>}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Duration</span>
                  <Select
                    label="Duration"
                    className="w-full sm:w-[260px] [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]"
                    value={months}
                    onChange={(e) => setMonths(Number(e.target.value))}
                  >
                    <option value={1}>1 month — {fmtUSD(SLOT_PRICE)}</option>
                    <option value={2}>2 months — {fmtUSD(SLOT_PRICE * 2)}</option>
                    <option value={3}>3 months — {fmtUSD(SLOT_PRICE * 3)}</option>
                  </Select>
                </label>

                <Field
                  label="Destination URL"
                  placeholder="https://your-landing-page.com"
                  value={url}
                  error={errors.url}
                  hint="Visitors who click your creative land here."
                  onChange={(e) => setUrl(e.target.value)}
                />

                {/* creative upload — local preview only */}
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Creative image</span>
                  <input
                    id="creative-file"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                  {creative ? (
                    <div className="flex items-center gap-3 rounded-lg border border-line bg-pcard p-3">
                      <img
                        src={creative.preview}
                        alt="Creative preview"
                        className="h-16 w-28 rounded-md border border-line object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-ink">{creative.name}</p>
                        <p className="mt-0.5 text-[10.5px] text-ink-3">
                          Local preview only — nothing is uploaded.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCreative(null)}
                        aria-label="Remove creative"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:border-zinc-500 hover:text-ink"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <label
                      htmlFor="creative-file"
                      className="block cursor-pointer rounded-lg border border-dashed border-line p-6 text-center transition-colors hover:border-accent/50"
                    >
                      <ImagePlus className="mx-auto h-6 w-6 text-accent" aria-hidden />
                      <p className="mt-2 text-[12px] font-medium text-ink">
                        Click to select a 16:9 creative
                      </p>
                      <p className="mt-1 text-[10.5px] text-ink-3">
                        PNG or JPG · 1200×675 recommended · max 5MB
                      </p>
                    </label>
                  )}
                </div>

                <div className="flex justify-end pt-1">
                  <Btn
                    onClick={() => {
                      if (validate()) setStep("review");
                    }}
                  >
                    Review campaign
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Btn>
                </div>
              </div>
            ) : (
              /* ------------------------------ review ------------------------------ */
              <div>
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back to edit
                </button>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">Review & confirm</h3>
                <p className="mt-0.5 text-[11.5px] text-ink-3">
                  Double-check the details below before reserving.
                </p>

                {creative && (
                  <img
                    src={creative.preview}
                    alt="Creative preview"
                    className="mt-4 h-36 w-full rounded-lg border border-line object-cover"
                  />
                )}

                <div className="mt-4 rounded-lg border border-line bg-pcard px-3.5">
                  <SummaryRow label="Campaign" value={name} />
                  <SummaryRow label="Placement" value={`Slot ${slotId} · ${slot?.name ?? ""}`} />
                  <SummaryRow label="Ratio" value="16:9" />
                  <SummaryRow label="Duration" value={`${months} month${months > 1 ? "s" : ""}`} />
                  <SummaryRow label="Destination" value={<span className="max-w-[240px] truncate">{url}</span>} />
                  <SummaryRow
                    label="Total due"
                    value={<span className="text-accent">{fmtUSD(total)}</span>}
                  />
                </div>

                {!sufficient ? (
                  <div className="mt-3.5">
                    <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-300">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Your wallet balance ({fmtUSD(wallet)}) is too low for this reservation.
                    </p>
                    <Btn className="mt-3 w-full" onClick={onAddFunds}>
                      Add funds to continue
                    </Btn>
                  </div>
                ) : (
                  <Btn
                    className="mt-4 w-full"
                    onClick={() => {
                      onSubmit({
                        name: name.trim(),
                        slotId: Number(slotId),
                        months,
                        url: url.trim(),
                        creativeName: creative?.name,
                        creativePreview: creative?.preview,
                      });
                      setStep("success");
                    }}
                  >
                    Confirm & reserve — {fmtUSD(total)}
                  </Btn>
                )}
                <p className="mt-2.5 text-center text-[10.5px] text-ink-3">
                  Demo checkout — no payment is processed.
                </p>
              </div>
            )}
          </Card>

          {/* summary aside */}
          <Card className={cn("p-4", step === "review" && "opacity-90")}>
            <h3 className="text-[13px] font-semibold text-ink">Price summary</h3>
            <div className="mt-2">
              <SummaryRow label="Placement" value={slot ? `Slot ${slot.id} · ${slot.name}` : "—"} />
              <SummaryRow label="Rate" value={`${fmtUSD(SLOT_PRICE)} /month`} />
              <SummaryRow label="Duration" value={`${months} month${months > 1 ? "s" : ""}`} />
              <SummaryRow label="Service fee" value={fmtUSD(0)} />
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[12px] font-medium text-ink-2">Total</span>
              <span className="text-[17px] font-semibold tabular-nums text-accent">{fmtUSD(total)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-pcard px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                <Wallet className="h-3.5 w-3.5 text-accent" aria-hidden /> Wallet
              </span>
              <span className="text-[12px] font-semibold tabular-nums text-ink">{fmtUSD(wallet)}</span>
            </div>
            <p className="mt-3 text-[10.5px] leading-relaxed text-ink-3">
              All placements are a flat {fmtUSD(SLOT_PRICE)} per month. Creatives are reviewed
              within 24 hours of reservation.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
