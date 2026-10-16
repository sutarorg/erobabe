import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PortalSidebar from "@/src/components/PortalSidebar";
import AdvertiserNav from "./AdvertiserNav";

export default async function AdvertiserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in?next=/advertiser");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "advertiser") {
    if (profile?.role === "admin") redirect("/admin");
    redirect("/auth/sign-in?next=/advertiser");
  }
  if (profile.status !== "active") {
    return (
      <div className="flex h-screen items-center justify-center bg-void">
        <div className="rounded-lg border border-line bg-pcard p-6 text-center">
          <p className="text-[14px] font-semibold">Account suspended</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Contact support for assistance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-void text-ink">
      <PortalSidebar portal="Advertiser" email={user.email || "Account"}>
        <AdvertiserNav />
      </PortalSidebar>
      <main className="center-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-10 pt-16 lg:px-6 lg:pt-5">{children}</div>
      </main>
    </div>
  );
}
