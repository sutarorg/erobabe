import { createServiceClient } from "@/lib/supabase/server";

export default async function UsersAdmin() {
  const supabase = createServiceClient();
  const { data: users } = await supabase.from("profiles").select("id, email, role, status, created_at").order("created_at", { ascending: false }).limit(100);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Users</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real user accounts — role assignment trusted DB process, no self-admin</p>

      {(users || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center"><p>No users yet</p></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th></tr></thead>
            <tbody>
              {(users || []).map((u: any) => (
                <tr key={u.id} className="border-b border-line/50"><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3 uppercase text-[11px]">{u.role}</td><td className="px-4 py-3">{u.status}</td><td className="px-4 py-3 text-ink-3">{new Date(u.created_at).toLocaleDateString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
