import { redirect } from "next/navigation";

/**
 * `/admin/sign-in` is an alias of the staff page at `/admin/signin`.
 *
 * Both spellings are typed into browsers, so the dashed one forwards instead of
 * 404-ing. It carries the `next` parameter across, and never forwards outside
 * `/admin`.
 */
export default async function AdminSignInAliasPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next && next.startsWith("/admin") ? `/admin/signin?next=${encodeURIComponent(next)}` : "/admin/signin");
}
