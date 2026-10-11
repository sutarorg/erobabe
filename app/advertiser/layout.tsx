import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import AdvertiserNav from "./AdvertiserNav";

export default async function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in?next=/advertiser");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
  if (!profile || profile.role !== "advertiser") {
    if (profile?.role === "admin") redirect("/admin");
    redirect("/auth/sign-in?next=/advertiser");
  }
  if (profile.status !== "active") {
    return (
      <div className="flex h-screen items-center justify-center bg-void">
        <div className="rounded-lg border border-line bg-pcard p-6 text-center">
          <p className="text-[14px] font-semibold">Account suspended</p>
          <p className="mt-1 text-[12px] text-ink-3">Contact support for assistance.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-void text-ink">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-psidebar lg:block">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
            <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" className="h-6 w-auto" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Advertiser</span>
          </div>
          <AdvertiserNav />
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
