import { createClient, createServiceClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const service = createServiceClient();
  const { data: profile } = await service.from("advertiser_profiles").select("*").eq("id", user.id).single();
  const { data: base } = await service.from("profiles").select("email, display_name").eq("id", user.id).single();

  return (
    <div className="max-w-xl">
      <h1 className="text-[20px] font-semibold">Profile</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real profile management — advertisers only access own information</p>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-5 space-y-4 text-[12.5px]">
        <div><p className="text-[11px] text-ink-3">Email</p><p className="font-medium">{base?.email}</p></div>
        <div><p className="text-[11px] text-ink-3">Company</p><p className="font-medium">{profile?.company_name || "—"}</p></div>
        <div><p className="text-[11px] text-ink-3">Contact</p><p>{profile?.contact_name || "—"}</p></div>
        <div><p className="text-[11px] text-ink-3">Website</p><p>{profile?.website || "—"}</p></div>
        <div><p className="text-[11px] text-ink-3">Country</p><p>{profile?.country || "—"}</p></div>
        <div><p className="text-[11px] text-ink-3">Status</p><p className="uppercase text-[11px]">{profile?.status}</p></div>
      </div>
    </div>
  );
}
