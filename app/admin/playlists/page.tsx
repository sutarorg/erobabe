import { createServiceClient } from "@/lib/supabase/server";

export default async function PlaylistsAdmin() {
  const supabase = createServiceClient();
  const { data: playlists } = await supabase.from("playlists").select("*").order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Playlists</h1>
      <p className="mt-1 text-[12px] text-ink-3">Curated collections — if retained</p>
      {(playlists || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center"><p className="text-[13px]">No playlists yet</p></div>
      ) : (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {(playlists || []).map((p: any) => (
            <div key={p.id} className="rounded-lg border border-line bg-pcard p-4">
              <p className="font-medium text-[13px]">{p.name}</p>
              <p className="mt-1 text-[11px] text-ink-3">{p.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
