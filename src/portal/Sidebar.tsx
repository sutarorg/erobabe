import {
  BarChart3,
  CirclePlus,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Megaphone,
  CreditCard,
  ReceiptText,
  UserRound,
  X,
} from "lucide-react";
import { LOGO_URL } from "./data";
import { cn } from "../utils/cn";

export type PortalView =
  | "dashboard"
  | "slots"
  | "campaigns"
  | "create"
  | "payments"
  | "invoices"
  | "analytics"
  | "profile"
  | "support";

export const NAV_ITEMS: { key: PortalView; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "slots", label: "Ad Slots", icon: LayoutGrid },
  { key: "campaigns", label: "My Campaigns", icon: Megaphone },
  { key: "create", label: "Create Campaign", icon: CirclePlus },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "invoices", label: "Invoices", icon: ReceiptText },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "profile", label: "Profile", icon: UserRound },
  { key: "support", label: "Support", icon: LifeBuoy },
];

interface SidebarProps {
  active: PortalView;
  onNavigate: (view: PortalView) => void;
  onLogout: () => void;
  onClose?: () => void;
}

export default function Sidebar({ active, onNavigate, onLogout, onClose }: SidebarProps) {
  return (
    <div className="flex h-full flex-col p-4">
      {/* Brand */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={LOGO_URL} alt="erobabe logo" className="h-7 w-auto object-contain" draggable={false} />
          <span className="text-[15px] font-bold tracking-tight text-ink">
            erobabe<span className="text-accent">.</span>
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-white/5 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
        Advertiser Portal
      </p>

      {/* Navigation */}
      <nav aria-label="Portal" className="center-scroll mt-4 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[12.5px] font-medium transition-colors",
                isActive
                  ? "border-accent/45 bg-accent/10 text-ink"
                  : "border-transparent text-ink-2 hover:bg-white/[0.04] hover:text-ink"
              )}
            >
              <Icon
                className={cn("h-4 w-4 shrink-0", isActive ? "text-accent" : "text-ink-3")}
                strokeWidth={1.9}
                aria-hidden
              />
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink"
        >
          <LogOut className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.9} aria-hidden />
          Log Out
        </button>
      </nav>

      {/* Support card */}
      <div className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.05] p-3.5">
        <h3 className="text-[12.5px] font-semibold text-ink">Need Help?</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          Our support team is here 24/7 to assist you.
        </p>
        <button
          type="button"
          onClick={() => onNavigate("support")}
          className="mt-3 flex h-8 w-full items-center justify-center rounded-md border border-accent/50 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          Contact Support
        </button>
      </div>
    </div>
  );
}
