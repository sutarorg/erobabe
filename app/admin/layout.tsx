import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminSidebar from "@/src/admin/AdminSidebar";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in?next=/admin");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    redirect("/auth/sign-in?next=/admin");
  }

  return (
    <div className="flex h-screen bg-void text-ink">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-psidebar lg:block">
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center gap-2 border-b border-line px-4">
            <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" className="h-6 w-auto" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Admin</span>
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {[
                { href: "/admin", label: "Dashboard" },
                { href: "/admin/videos", label: "Videos" },
                { href: "/admin/videos/upload", label: "Upload" },
                { href: "/admin/categories", label: "Categories" },
                { href: "/admin/playlists", label: "Playlists" },
                { href: "/admin/advertisements", label: "Advertisements" },
                { href: "/admin/ad-slots", label: "Ad Slots" },
                { href: "/admin/advertisers", label: "Advertisers" },
                { href: "/admin/campaigns", label: "Campaigns" },
                { href: "/admin/payments", label: "Payments" },
                { href: "/admin/reports", label: "Reports" },
                { href: "/admin/users", label: "Users" },
                { href: "/admin/settings", label: "Settings" },
                { href: "/admin/logs", label: "Logs" },
                { href: "/admin/system-health", label: "System Health" },
              ].map((item) => (
                <Link key={item.href} href={item.href} className="block rounded-md px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:bg-white/5 hover:text-ink">
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
          <div className="border-t border-line p-3">
            <Link href="/" className="block rounded-md px-3 py-2 text-[12px] text-ink-3 hover:text-ink">← Public site</Link>
            <form action="/auth/sign-out" method="post">
              <button type="submit" className="mt-1 w-full rounded-md px-3 py-2 text-left text-[12px] text-ink-3 hover:text-ink">Sign out</button>
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
