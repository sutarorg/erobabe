import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminVideosPage() {
  const supabase = createServiceClient();
  const { data: videos } = await supabase.from("videos").select("id, slug, title, status, visibility, rights_status, moderation_status, view_count, created_at, category:categories(label)").order("created_at", { ascending: false }).limit(100);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold">Videos</h1>
        <Link href="/admin/videos/upload" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">Upload</Link>
      </div>

      {(videos || []).length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px] font-medium">No videos published yet</p>
          <p className="mt-1 text-[12px] text-ink-3">Upload your first video to get started.</p>
          <Link href="/admin/videos/upload" className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">Upload video</Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Rights</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(videos || []).map((v: any) => (
                <tr key={v.id} className="border-b border-line/50 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <p className="font-medium">{v.title}</p>
                    <p className="text-[11px] text-ink-3">{v.category?.label || "—"}</p>
                  </td>
                  <td className="px-4 py-3"><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{v.status}</span></td>
                  <td className="px-4 py-3 text-[11px]">{v.rights_status}</td>
                  <td className="px-4 py-3 tabular-nums">{v.view_count || 0}</td>
                  <td className="px-4 py-3 text-[11px] text-ink-3">{new Date(v.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Link href={`/video/${v.slug}`} target="_blank" className="text-accent hover:underline text-[11px]">View</Link>
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
