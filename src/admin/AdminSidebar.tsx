import {
  Activity,
  Building2,
  Clapperboard,
  CreditCard,
  Flag,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  ListVideo,
  Megaphone,
  ScrollText,
  Settings,
  Target,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { LOGO_URL } from "../data/content";
import { cn } from "../utils/cn";

export type AdminView =
  | "dashboard" | "videos" | "upload" | "categories" | "playlists" | "ads" | "slots"
  | "advertisers" | "campaigns" | "payments" | "reports" | "users"
  | "settings" | "logs" | "health";

const NAV_ITEMS: { key: AdminView; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "videos", label: "Videos", icon: Clapperboard },
  { key: "upload", label: "Upload", icon: UploadCloud },
  { key: "categories", label: "Categories", icon: LayoutGrid },
  { key: "playlists", label: "Playlists", icon: ListVideo },
  { key: "ads", label: "Advertisements", icon: Megaphone },
  { key: "slots", label: "Ad Slots", icon: Layers },
  { key: "advertisers", label: "Advertisers", icon: Building2 },
  { key: "campaigns", label: "Campaigns", icon: Target },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "reports", label: "Reports", icon: Flag },
  { key: "users", label: "Users", icon: Users },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "logs", label: "Logs", icon: ScrollText },
  { key: "health", label: "System Health", icon: Activity },
];

interface AdminSidebarProps {
  active: AdminView;
  onNavigate: (view: AdminView) => void;
  onSite: () => void;
  onAdvertise: () => void;
  onClose?: () => void;
}

export default function AdminSidebar({ active, onNavigate, onSite, onAdvertise, onClose }: AdminSidebarProps) {
  return (
    <div className="flex h-full flex-col p-4">
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
        Admin Portal
      </p>

      <nav aria-label="Admin" className="center-scroll mt-4 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
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
                "flex w-full items-center gap-2.5 rounded-lg border px-3 py-[7px] text-left text-[12.5px] font-medium transition-colors",
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
      </nav>

      {/* Product links */}
      <div className="mt-4 flex items-center justify-center gap-2 text-[10.5px] text-ink-3">
        <button type="button" onClick={onSite} className="transition-colors hover:text-accent">
          Public site
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={onAdvertise} className="transition-colors hover:text-accent">
          Advertiser portal
        </button>
      </div>
    </div>
  );
}
