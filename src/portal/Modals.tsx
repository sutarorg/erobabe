import { CalendarDays, CircleCheck, CreditCard, Pause, Play, Wallet } from "lucide-react";
import { useState } from "react";
import { cn } from "../utils/cn";
import { fmtUSD, type Campaign } from "./data";
import { Btn, Modal, ModalHeader, StatusPill } from "./ui";

/* --------------------------- Add Funds ---------------------------- */

const PRESETS = [50, 100, 250, 500];

export function AddFundsModal({
  wallet,
  onClose,
  onConfirm,
}: {
  wallet: number;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}) {
  const [amount, setAmount] = useState<number>(100);
  const [step, setStep] = useState<"form" | "success">("form");

  return (
    <Modal onClose={onClose} labelledBy="add-funds-title">
      <ModalHeader title="Add Funds" sub="Top up your advertiser wallet" onClose={onClose} />
      {step === "form" ? (
        <div className="p-5">
          <div className="flex items-center justify-between rounded-lg border border-line bg-pcard px-3.5 py-3">
            <span className="flex items-center gap-2 text-[12px] text-ink-2">
              <Wallet className="h-4 w-4 text-accent" aria-hidden /> Current balance
            </span>
            <span className="text-[14px] font-semibold text-ink">{fmtUSD(wallet)}</span>
          </div>

          <p className="mt-4 text-[11.5px] font-medium text-ink-2">Select amount</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                aria-pressed={amount === p}
                className={cn(
                  "h-9 rounded-md border text-[12.5px] font-semibold transition-colors",
                  amount === p
                    ? "border-accent/60 bg-accent/12 text-accent"
                    : "border-line bg-pcard text-ink-2 hover:border-zinc-500 hover:text-ink"
                )}
              >
                ${p}
              </button>
            ))}
          </div>

          <label className="mt-3.5 block">
            <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Custom amount</span>
            <input
              type="number"
              min={10}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] text-ink outline-none focus:border-accent/60"
            />
          </label>

          <div className="mt-3.5 flex items-center justify-between rounded-lg border border-line bg-pcard px-3.5 py-3">
            <span className="flex items-center gap-2 text-[12px] text-ink-2">
              <CreditCard className="h-4 w-4 text-ink-3" aria-hidden /> Visa •••• 4242
            </span>
            <span className="text-[10.5px] font-medium text-ink-3">Default method</span>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Demo only — no payment will be processed and no card will be charged.
          </p>
          <Btn
            className="mt-3 w-full"
            disabled={amount < 10}
            onClick={() => {
              onConfirm(amount);
              setStep("success");
            }}
          >
            Add {fmtUSD(amount)} to wallet
          </Btn>
        </div>
      ) : (
        <div className="flex flex-col items-center p-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <CircleCheck className="h-6 w-6 text-emerald-400" aria-hidden />
          </span>
          <h3 className="mt-3 text-[15px] font-semibold text-ink">Wallet topped up</h3>
          <p className="mt-1.5 max-w-[280px] text-[12px] leading-relaxed text-ink-3">
            {fmtUSD(amount)} was added to your demo balance. Your new balance is{" "}
            {fmtUSD(wallet + amount)}.
          </p>
          <Btn className="mt-4 w-full" onClick={onClose}>
            Done
          </Btn>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------- Campaign details ------------------------ */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-pcard px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</p>
      <p className="mt-1 text-[14px] font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function CampaignModal({
  campaign,
  onClose,
  onTogglePause,
}: {
  campaign: Campaign;
  onClose: () => void;
  onTogglePause: (campaign: Campaign) => void;
}) {
  const live = campaign.status === "active" || campaign.status === "paused";
  return (
    <Modal onClose={onClose} maxW="max-w-lg" labelledBy="campaign-title">
      <ModalHeader title={campaign.name} sub={`Slot ${campaign.slotId} · ${campaign.placement}`} onClose={onClose} />
      <div className="p-5">
        <div className="relative h-32 overflow-hidden rounded-lg border border-line">
          <img
            src={campaign.thumb}
            alt={`${campaign.name} creative`}
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-2.5 left-3">
            <StatusPill status={campaign.status} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-3">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {campaign.start} — {campaign.end}
        </div>

        {campaign.note && (
          <p className="mt-3 rounded-lg border border-line bg-pcard p-3 text-[11.5px] leading-relaxed text-ink-3">
            {campaign.note}
          </p>
        )}

        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Impressions" value={campaign.impressions} />
          <Stat label="Clicks" value={campaign.clicks} />
          <Stat label="CTR" value={campaign.ctr} />
          <Stat label="Spend" value={campaign.spend ? fmtUSD(campaign.spend) : "—"} />
        </div>

        {campaign.status === "active" && (
          <div className="mt-3.5">
            <div className="flex items-center justify-between text-[10.5px] text-ink-3">
              <span>{campaign.progress}% of period elapsed</span>
              <span className="tabular-nums">{100 - campaign.progress}% remaining</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-void">
              <div className="h-full rounded-full bg-accent" style={{ width: `${campaign.progress}%` }} />
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {live && (
            <Btn variant="outline" className="flex-1" onClick={() => onTogglePause(campaign)}>
              {campaign.status === "active" ? (
                <>
                  <Pause className="h-3.5 w-3.5" aria-hidden /> Pause campaign
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden /> Resume campaign
                </>
              )}
            </Btn>
          )}
          <Btn variant="primary" className="flex-1" onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
