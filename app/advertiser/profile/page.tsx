import { createClient, createServiceClient } from "@/lib/supabase/server";
import ProfileManager from "./ProfileManager";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();
  const [{ data: advertiserProfile }, { data: baseProfile }] = await Promise.all([
    service.from("advertiser_profiles").select("*").eq("id", user.id).single(),
    service.from("profiles").select("email, display_name, company_name, contact_name, website, country").eq("id", user.id).single(),
  ]);

  return (
    <ProfileManager
      email={baseProfile?.email || user.email || ""}
      initialValues={{
        displayName: baseProfile?.display_name || "",
        companyName: advertiserProfile?.company_name || baseProfile?.company_name || "",
        contactName: advertiserProfile?.contact_name || baseProfile?.contact_name || "",
        website: advertiserProfile?.website || baseProfile?.website || "",
        country: advertiserProfile?.country || baseProfile?.country || "",
      }}
    />
  );
}
