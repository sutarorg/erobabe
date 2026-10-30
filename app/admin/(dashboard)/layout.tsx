import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminShell from "./AdminShell";

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

  return <AdminShell email={user.email || "Account"}>{children}</AdminShell>;
}
