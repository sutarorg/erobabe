import { ArrowRight, CalendarDays, CircleCheck, Eye, Info, MousePointerClick, TriangleAlert, Wallet } from "lucide-react";
import { useState } from "react";
import { fmtUSD, SLOT_PRICE, type Slot } from "./data";
import { Btn, Drawer, StatusPill } from "./ui";

interface SlotDrawerProps {
  slot: Slot;
  wallet: number;
  onClose: () => void;
  onReserve: (slotId: number) => void;
  onAddFunds: () => void;
  onNotify: (message: string) => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 py-2.5 text-[12px] last:border-0">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

export default function SlotDrawer({
  slot,
  wallet,
  onClose,
  onReserve,
  onAddFunds,
  onNotify,
}: SlotDrawerProps) {
  const [step, setStep] = useState<"details" | "confirm" | "success">("details");
  const available = slot.status === "available";
  const sufficient = wallet >= SLOT_PRICE;

  return (
    <Drawer onClose={onClose} title={`Slot ${slot.id} — ${slot.name}`} sub="Fixed-price 16:9 placement">
      {/* Placement preview — echoes the public-site ad slot treatment */}
      <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg border border-accent/35 bg-pcard-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-300">
          Ad Slot {slot.id}
        </span>
        <span className="text-[11px] font-medium tracking-[0.16em] text-accent">16:9</span>
        <span className="mt-1 text-[10px] text-ink-3">
          {slot.side === "left" ? "Left rail" : "Right rail"} placement
        </span>
      </div>

      {step === "details" && (
        <>
          <div className="mt-4 flex items-center justify-between">
            <StatusPill status={slot.status} />
            <span className="text-[15px] font-semibold text-ink">
              {fmtUSD(SLOT_PRICE)}
              <span className="text-[11px] font-medium text-ink-3"> /month</span>
            </span>
          </div>

          <div className="mt-3 rounded-lg border border-line bg-pcard px-3.5">
            <InfoRow label="Position" value={slot.side === "left" ? "Left rail" : "Right rail"} />
            <InfoRow label="Fixed ratio" value="16:9" />
            <InfoRow
              label="Est. impressions"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-ink-3" aria-hidden /> {slot.estImpr}/day
                </span>
              }
            />
            <InfoRow
              label="Avg. CTR"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <MousePointerClick className="h-3.5 w-3.5 text-ink-3" aria-hidden /> {slot.ctr}
                </span>
              }
            />
            <InfoRow
              label="Current advertiser"
              value={available ? <span className="text-ink-3">Vacant</span> : slot.advertiser}
            />
            {!available && slot.start && (
              <InfoRow
                label="Campaign period"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                    {slot.start} – {slot.end}
                  </span>
                }
              />
            )}
          </div>

          {available ? (
            <>
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-pcard p-3 text-[11.5px] leading-relaxed text-ink-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                Reservations are fixed at {fmtUSD(SLOT_PRICE)} for 30 days, billed from your wallet
                balance. Your creative is reviewed within 24 hours.
              </p>
              <Btn className="mt-4 w-full" onClick={() => setStep("confirm")}>
                Reserve this slot — {fmtUSD(SLOT_PRICE)}/month
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Btn>
            </>
          ) : (
            <>
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-pcard p-3 text-[11.5px] leading-relaxed text-ink-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                This placement is currently booked. Join the waitlist and we will let you know the
                moment it becomes available.
              </p>
              <Btn
                variant="accentOutline"
                className="mt-4 w-full"
                onClick={() => {
                  onNotify(`You're on the waitlist for Slot ${slot.id} (demo).`);
                  onClose();
                }}
              >
                Notify me when available
              </Btn>
            </>
          )}
        </>
      )}

      {step === "confirm" && (
        <>
          <h3 className="mt-5 text-[13px] font-semibold text-ink">Reservation summary</h3>
          <div className="mt-2.5 rounded-lg border border-line bg-pcard px-3.5">
            <InfoRow label="Placement" value={`Slot ${slot.id} · ${slot.name}`} />
            <InfoRow label="Duration" value="30 days" />
            <InfoRow label="Rate" value={`${fmtUSD(SLOT_PRICE)} /month`} />
            <InfoRow label="Service fee" value={fmtUSD(0)} />
            <InfoRow
              label="Total due"
              value={<span className="text-accent">{fmtUSD(SLOT_PRICE)}</span>}
            />
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-pcard px-3.5 py-3">
            <span className="flex items-center gap-2 text-[12px] text-ink-2">
              <Wallet className="h-4 w-4 text-accent" aria-hidden /> Wallet balance
            </span>
            <span className="text-[13px] font-semibold text-ink">{fmtUSD(wallet)}</span>
          </div>

          {!sufficient && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Your balance is too low for this reservation. Add funds to continue.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Btn variant="outline" className="flex-1" onClick={() => setStep("details")}>
              Back
            </Btn>
            {sufficient ? (
              <Btn
                className="flex-1"
                onClick={() => {
                  onReserve(slot.id);
                  setStep("success");
                }}
              >
                Confirm reservation
              </Btn>
            ) : (
              <Btn className="flex-1" onClick={onAddFunds}>
                Add funds
              </Btn>
            )}
          </div>
        </>
      )}

      {step === "success" && (
        <div className="mt-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <CircleCheck className="h-6 w-6 text-emerald-400" aria-hidden />
          </span>
          <h3 className="mt-3 text-[15px] font-semibold text-ink">Reservation confirmed</h3>
          <p className="mt-1.5 max-w-[280px] text-[12px] leading-relaxed text-ink-3">
            Slot {slot.id} is now booked for EroAds Media. This is a demo — no payment was
            processed and no real reservation was made.
          </p>
          <div className="mt-4 w-full rounded-lg border border-line bg-pcard px-3.5">
            <InfoRow label="Charged to wallet" value={fmtUSD(SLOT_PRICE)} />
            <InfoRow label="Duration" value="30 days" />
          </div>
          <Btn className="mt-4 w-full" onClick={onClose}>
            Done
          </Btn>
        </div>
      )}
    </Drawer>
  );
}
