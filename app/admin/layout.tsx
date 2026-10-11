import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BadgeDollarSign,
  Clapperboard,
  CreditCard,
  Film,
  Flag,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelsTopLeft,
  Radio,
  ScrollText,
  Tag,
  UploadCloud,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

const adminNavigation: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/videos", label: "Videos", icon: Film },
  { href: "/admin/videos/upload", label: "Upload", icon: UploadCloud },
  { href: "/admin/categories", label: "Categories", icon: Tag },
  { href: "/admin/advertisements", label: "Advertisements", icon: Megaphone },
  { href: "/admin/ad-slots", label: "Ad Slots", icon: PanelsTopLeft },
  { href: "/admin/advertisers", label: "Advertisers", icon: UsersRound },
  { href: "/admin/campaigns", label: "Campaigns", icon: Radio },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/logs", label: "Logs", icon: ScrollText },
  { href: "/admin/system-health", label: "System Health", icon: Activity },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in?next=/admin");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    redirect("/auth/sign-in?next=/admin");
  }

  return (
    <div className="flex h-screen bg-void text-ink">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-psidebar lg:block">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
            <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" className="h-6 w-auto" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Admin</span>
          </div>
          <nav aria-label="Admin navigation" className="no-scrollbar flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {adminNavigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:bg-white/5 hover:text-ink"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
          <div className="shrink-0 border-t border-line p-3">
            <Link href="/" className="flex items-center gap-2 rounded-md px-3 py-2 text-[12px] text-ink-3 hover:text-ink">
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
              Public site
            </Link>
            <form action="/auth/sign-out" method="post">
              <button type="submit" className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] text-ink-3 hover:text-ink">
                <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="center-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-10 pt-5 lg:px-6">{children}</div>
      </main>
    </div>
  );
}
