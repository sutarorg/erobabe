import { createServiceClient } from "@/lib/supabase/server";

export default async function CategoriesAdmin() {
  const supabase = createServiceClient();
  const { data: categories } = await supabase.from("categories").select("*").order("label");

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Categories</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real taxonomy — 12 fixed categories, admin manageable. Prevent breaking existing content relationships.</p>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {(categories || []).map((c: any) => (
          <div key={c.id} className="rounded-lg border border-line bg-pcard p-4">
            <p className="text-[13px] font-medium">{c.label}</p>
            <p className="mt-1 text-[11px] text-ink-3">Slug: {c.slug}</p>
            <p className="mt-1 text-[11px] text-ink-3">Icon: {c.icon}</p>
          </div>
        ))}
      </div>

      {(categories || []).length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-8 text-center">
          <p className="text-[13px]">No categories yet — seed migration should create 12 fixed categories</p>
        </div>
      )}
    </div>
  );
}
