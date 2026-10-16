import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PortalSidebar from "@/src/components/PortalSidebar";
import AdminNav from "./AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/signin?next=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    redirect("/admin/signin?next=/admin");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-void text-ink">
      <PortalSidebar portal="Admin" email={user.email || "Account"}>
        <AdminNav />
      </PortalSidebar>
      <main className="center-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-10 pt-16 lg:px-6 lg:pt-5">{children}</div>
      </main>
    </div>
  );
}
