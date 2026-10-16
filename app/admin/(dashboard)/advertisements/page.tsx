import AdminRecordActions from "@/src/components/AdminRecordActions";
import { createServiceClient } from "@/lib/supabase/server";

export default async function AdsAdmin() {
  const supabase = createServiceClient();
  const { data: creatives } = await supabase
    .from("ad_creatives")
    .select(
      "id, title, status, destination_url, image_url, created_at, advertiser_id",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Advertisements</h1>
      <p className="mt-1 text-[12px] text-ink-3">
        Review creatives — must be approved before public display. Validate
        16:9, file types, safe URLs.
      </p>

      {(creatives || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-8 text-center">
          <p className="text-[13px]">No creatives submitted yet</p>
        </div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {(creatives || []).map((c: any) => (
                <tr key={c.id} className="border-b border-line/50">
                  <td className="px-4 py-3">
                    {c.title}
                    {c.image_url && (
                      <a
                        href={c.image_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block text-accent"
                      >
                        Inspect creative image
                      </a>
                    )}
                    <AdminRecordActions
                      id={c.id}
                      actions={[
                        { action: "approve_creative", label: "Approve" },
                        { action: "reject_creative", label: "Reject" },
                      ]}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 truncate max-w-[200px] text-ink-3">
                    {c.destination_url}
                  </td>
                  <td className="px-4 py-3 text-ink-3">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
