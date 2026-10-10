import { Ban, Undo2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, PageHeader } from "../portal/ui";
import { cn } from "../utils/cn";
import type { Report, UserAccount } from "./data";
import { AdminBadge, TH_CLASS } from "./widgets";

/* ------------------------------ Reports ----------------------------- */

type ReportTab = "all" | Report["status"];

export function ReportsView({
  reports,
  onOpenReport,
}: {
  reports: Report[];
  onOpenReport: (report: Report) => void;
}) {
  const [tab, setTab] = useState<ReportTab>("all");
  const tabs: { key: ReportTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "in-review", label: "In Review" },
    { key: "resolved", label: "Resolved" },
  ];
  const filtered = useMemo(() => reports.filter((r) => tab === "all" || r.status === tab), [reports, tab]);
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: reports.length };
    reports.forEach((r) => { m[r.status] = (m[r.status] ?? 0) + 1; });
    return m;
  }, [reports]);

  return (
    <div>
      <PageHeader title="Reports" sub="Copyright complaints, content flags and ad reports — all fictional." />

      <div className="mt-4 flex w-fit items-center gap-1 rounded-lg border border-line bg-pcard p-1" role="tablist" aria-label="Filter reports">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
              tab === t.key ? "bg-white/[0.07] text-ink" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {t.label}
            <span className={cn("text-[9.5px] tabular-nums", tab === t.key ? "text-accent" : "text-ink-3")}>
              {t.key === "all" ? counts.all : counts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Type", "Reason", "Content", "Reported By", "Date", "Status"].map((h) => (
                  <th key={h} className={TH_CLASS}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => onOpenReport(r)} className="cursor-pointer transition-colors hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] font-medium text-ink-2">{r.type}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">{r.reason}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-[11.5px] text-ink">{r.content}</td>
                  <td className="px-4 py-3 text-[11.5px] text-ink-3">{r.reportedBy}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] text-ink-3">{r.date}</td>
                  <td className="px-4 py-3"><AdminBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-ink-3">No reports in this queue.</p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------- Users ------------------------------ */

export function UsersView({
  users,
  onToggleStatus,
}: {
  users: UserAccount[];
  onToggleStatus: (user: UserAccount) => void;
}) {
  return (
    <div>
      <PageHeader title="Users" sub={`${users.length} accounts with portal access.`} />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["User", "Role", "Joined", "Status", "Actions"].map((h) => (
                  <th key={h} className={cn(TH_CLASS, h === "Actions" && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-pcard-2 text-ink-2">
                        <UserRound className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div>
                        <p className="text-[12.5px] font-medium text-ink">{u.name}</p>
                        <p className="text-[10.5px] text-ink-3">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      u.role === "Administrator"
                        ? "border-accent/45 bg-accent/8 text-accent"
                        : "border-line text-ink-2"
                    )}>
                      {u.role}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] text-ink-3">{u.joined}</td>
                  <td className="px-4 py-3"><AdminBadge status={u.status} label={u.status === "active" ? "Active" : "Disabled"} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onToggleStatus(u)}
                        aria-label={u.status === "active" ? `Disable ${u.name}` : `Enable ${u.name}`}
                        className={cn(
                          "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
                          u.status === "active"
                            ? "border-line text-ink-3 hover:border-red-500/50 hover:text-red-400"
                            : "border-line text-ink-3 hover:border-emerald-500/50 hover:text-emerald-400"
                        )}
                        disabled={u.role === "Administrator"}
                        title={u.role === "Administrator" ? "The super administrator cannot be disabled" : undefined}
                      >
                        {u.status === "active" ? (
                          <><Ban className="h-3 w-3" aria-hidden /> Disable</>
                        ) : (
                          <><Undo2 className="h-3 w-3" aria-hidden /> Enable</>
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
