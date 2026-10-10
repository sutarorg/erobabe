import { createServiceClient } from "@/lib/supabase/server";

export default async function SettingsAdmin() {
  const supabase = createServiceClient();
  const { data: settings } = await supabase.from("site_settings").select("*").eq("id", 1).single();

  return (
    <div className="max-w-2xl">
      <h1 className="text-[20px] font-semibold">Settings</h1>
      <p className="mt-1 text-[12px] text-ink-3">Site configuration — real DB record, audited</p>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-5 space-y-4 text-[12.5px]">
        <div><p className="text-[11px] text-ink-3">Site title</p><p className="font-medium">{settings?.site_title}</p></div>
        <div><p className="text-[11px] text-ink-3">Tagline</p><p>{settings?.tagline}</p></div>
        <div><p className="text-[11px] text-ink-3">Slot price</p><p>${(settings?.slot_price_cents / 100).toFixed(2)}/mo</p></div>
        <div><p className="text-[11px] text-ink-3">Support email</p><p>{settings?.support_email || "Not set — owner must provide"}</p></div>
        <div><p className="text-[11px] text-ink-3">Contact email</p><p>{settings?.contact_email || "Not set — owner must provide"}</p></div>
        <div><p className="text-[11px] text-ink-3">Maintenance</p><p>{settings?.maintenance_mode ? "Enabled" : "Disabled"}</p></div>
        <div><p className="text-[11px] text-ink-3">Mature warning</p><p>{settings?.mature_warning ? "Enabled" : "Disabled"}</p></div>
      </div>

      <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] text-amber-100/70">
        Do not invent operator legal identity, business address, or contact details. Document owner-provided values required before launch.
      </div>
    </div>
  );
}
