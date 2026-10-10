import { Ban, Plus, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Card, PageHeader, Select } from "../portal/ui";
import { cn } from "../utils/cn";
import { fmtUSD, type AdminCampaign, type Advertiser, type Payment } from "./data";
import { AdminBadge, TH_CLASS } from "./widgets";

/* ---------------------------- Advertisers --------------------------- */

export function AdvertisersView({
  advertisers,
  onAddClick,
  onToggleSuspend,
}: {
  advertisers: Advertiser[];
  onAddClick: () => void;
  onToggleSuspend: (a: Advertiser) => void;
}) {
  return (
    <div>
      <PageHeader
        title="Advertisers"
        sub={`${advertisers.length} registered advertising accounts.`}
        actions={
          <Btn size="sm" onClick={onAddClick}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add Advertiser
          </Btn>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Business", "Contact", "Registered", "Campaigns", "Status", "Actions"].map((h) => (
                  <th key={h} className={cn(TH_CLASS, h === "Actions" && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {advertisers.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-[12.5px] font-medium text-ink">{a.name}</td>
                  <td className="px-4 py-3">
                    <span className="block text-[11.5px] text-ink-2">{a.contact}</span>
                    <span className="text-[10.5px] text-ink-3">{a.email}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] text-ink-3">{a.registered}</td>
                  <td className="px-4 py-3 text-[12px] tabular-nums text-ink-2">{a.campaigns}</td>
                  <td className="px-4 py-3"><AdminBadge status={a.status} /></td>
                  <td className="px-4 py-3">
                    {/* Accounts are active on sign-up — admins can only suspend. */}
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => onToggleSuspend(a)}
                        aria-label={a.status === "active" ? `Suspend ${a.name}` : `Reactivate ${a.name}`}
                        className={cn(
                          "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
                          a.status === "active"
                            ? "border-line text-ink-3 hover:border-red-500/50 hover:text-red-400"
                            : "border-line text-ink-3 hover:border-emerald-500/50 hover:text-emerald-400"
                        )}
                      >
                        {a.status === "active" ? (
                          <><Ban className="h-3 w-3" aria-hidden /> Suspend</>
                        ) : (
                          <><Undo2 className="h-3 w-3" aria-hidden /> Reactivate</>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- Campaigns ---------------------------- */

export function CampaignsView({ campaigns }: { campaigns: AdminCampaign[] }) {
  const [filter, setFilter] = useState("all");
  const filtered = useMemo(() => campaigns.filter((c) => filter === "all" || c.status === filter), [campaigns, filter]);

  return (
    <div>
      <PageHeader
        title="Campaigns"
        sub="All booked placements across the network."
        actions={
          <Select label="Filter campaigns" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </Select>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Campaign", "Advertiser", "Placement", "Period", "Status", "Price", "Impressions", "Clicks"].map((h) => (
                  <th key={h} className={TH_CLASS}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtered.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-[12.5px] font-medium text-ink">{c.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">{c.advertiser}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">{c.placement}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] text-ink-3">{c.start.split(",")[0]} – {c.end.split(",")[0]}</td>
                  <td className="px-4 py-3"><AdminBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-[12px] tabular-nums text-ink-2">{fmtUSD(c.price)}</td>
                  <td className="px-4 py-3 text-[12px] tabular-nums text-ink-2">{c.impressions}</td>
                  <td className="px-4 py-3 text-[12px] tabular-nums text-ink-2">{c.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- Payments ----------------------------- */

export function PaymentsView({ payments }: { payments: Payment[] }) {
  const collected = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const pending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const failed = payments.filter((p) => p.status === "failed").length;

  return (
    <div>
      <PageHeader title="Payments" sub="Fictional payment records for the demo billing ledger." />

      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          { label: "Collected", value: fmtUSD(collected), tone: "text-emerald-400" },
          { label: "Pending", value: fmtUSD(pending), tone: "text-amber-400" },
          { label: "Failed attempts", value: String(failed), tone: "text-red-400" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{s.label}</p>
            <p className={cn("mt-1 text-[18px] font-semibold tabular-nums", s.tone)}>{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["ID", "Advertiser", "Description", "Amount", "Method", "Date", "Status"].map((h) => (
                  <th key={h} className={TH_CLASS}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {payments.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-[12px] font-semibold text-ink">{p.id}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">{p.advertiser}</td>
                  <td className="px-4 py-3 text-[11.5px] text-ink-2">{p.desc}</td>
                  <td className="px-4 py-3 text-[12px] font-semibold tabular-nums text-ink">{fmtUSD(p.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-3">{p.method}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] text-ink-3">{p.date}</td>
                  <td className="px-4 py-3"><AdminBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
