import { createClient } from "@/lib/supabase/server";
import SupportForm from "./SupportForm";
export default async function SupportPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: tickets, error } = await db
    .from("support_tickets")
    .select("id, subject, status, created_at")
    .eq("advertiser_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Unable to load support tickets");
  return (
    <>
      <SupportForm />
      <section className="mt-8">
        <h2 className="font-semibold">Your tickets</h2>
        {tickets?.length ? (
          tickets.map((t: any) => (
            <div key={t.id} className="mt-3 rounded border border-line p-4">
              <p>{t.subject}</p>
              <p className="text-sm text-ink-3">
                {t.status} · {new Date(t.created_at).toLocaleDateString()}
              </p>
            </div>
          ))
        ) : (
          <p className="mt-3 text-sm text-ink-3">
            No tickets yet. Refresh after submitting to see your new ticket.
          </p>
        )}
      </section>
    </>
  );
}
