import Link from "next/link";
import { ExternalLink, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { tryCreateServiceClient } from "@/lib/supabase/server";
import AdOrderActions from "./AdOrderActions";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ value }: { value: string }) {
  const live = value === "live" || value === "verified";
  const rejected = value === "rejected";
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wider ${live ? "bg-emerald-500/10 text-emerald-300" : rejected ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

/** One label/value pair in the media column — fills the space under the banner. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[10.5px]">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-ink-2">{value}</dd>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function AdsAdmin() {
  const supabase = tryCreateServiceClient();
  const { data: orders, error } = supabase
    ? await supabase
    .from("ad_orders")
    .select(`
      id, slot_id, ad_name, contact_name, company_name, email,
      about_advertiser, destination_url, image_url, dimensions,
      duration_months, amount_cents, currency, paypal_transaction_id,
      payment_status, payment_verified_at, status, starts_at, ends_at,
      live_email_sent_at, created_at
    `)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: { message: "Supabase is not configured" } };

  const rows = (orders || []) as any[];
  const awaitingReview = rows.filter((order) => order.status === "in_review").length;
  const awaitingPayment = rows.filter((order) => order.status === "in_review" && order.payment_status === "unverified").length;
  const live = rows.filter((order) => order.status === "live").length;
  const rejected = rows.filter((order) => order.status === "rejected").length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">Ad review</h1>
          <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-ink-3">
            Review guest submissions, verify PayPal payments manually, approve ads to go live — and
            delete an advertisement permanently when it must come down.
          </p>
        </div>
        <Link href="/admin/payments" className="rounded-md border border-line bg-pcard px-3 py-2 text-[11px] text-ink-2 hover:bg-white/5">Payment history</Link>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[10px] uppercase tracking-wider text-ink-3">Awaiting review</p><p className="mt-1 text-[22px] font-semibold">{awaitingReview}</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[10px] uppercase tracking-wider text-ink-3">Payment to verify</p><p className="mt-1 text-[22px] font-semibold">{awaitingPayment}</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[10px] uppercase tracking-wider text-ink-3">Live in latest 100</p><p className="mt-1 text-[22px] font-semibold">{live}</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[10px] uppercase tracking-wider text-ink-3">Rejected — ready to delete</p><p className="mt-1 text-[22px] font-semibold">{rejected}</p></div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="flex items-start gap-3 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] p-4 text-[11.5px] leading-relaxed text-sky-100/80">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
          <p><strong className="text-sky-200">Manual payment check required.</strong> Open your PayPal account and confirm the amount and sender before choosing “Confirm PayPal payment.” Payment verification alone does not publish the ad; use “Approve & make live” after reviewing the banner and destination.</p>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-4 text-[11.5px] leading-relaxed text-red-100/80">
          <Trash2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <p><strong className="text-red-200">Deleting is permanent.</strong> Delete frees the slot immediately and removes the banner file. A deleted ad is no longer counted in <strong className="text-red-200">Verified Ad Revenue</strong> — including an ad removed before its 30 days have run out.</p>
        </div>
      </div>

      {error && <p role="alert" className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-[12px] text-red-300">Unable to load ad orders. Apply the latest database migration and try again.</p>}

      {!error && rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px] font-medium">No ad submissions yet</p>
          <p className="mt-1 text-[12px] text-ink-3">New guest PayPal checkouts will appear here for review.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {rows.map((order) => (
            <article key={order.id} className="overflow-hidden rounded-xl border border-line bg-pcard">
              <div className="grid lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
                {/* Media column: the banner plus its figures, stretched to the
                    full card height so no blank space is left under the image. */}
                <div className="flex flex-col border-b border-line bg-black/20 lg:border-b-0 lg:border-r">
                  <a
                    href={order.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block bg-black"
                    aria-label={`Inspect ${order.ad_name} banner`}
                  >
                    <img
                      src={order.image_url}
                      alt={`${order.ad_name} submitted banner`}
                      className="aspect-video w-full object-contain transition group-hover:opacity-90"
                    />
                    <span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[9px] text-white">
                      16:9 · {order.dimensions}
                    </span>
                  </a>
                  <dl className="flex flex-1 flex-col justify-center gap-2 border-t border-line/60 px-4 py-3">
                    <Meta label="Placement" value={`Slot ${order.slot_id} · ${order.duration_months} ${order.duration_months === 1 ? "month" : "months"}`} />
                    <Meta label="Order value" value={`${money(order.amount_cents)} ${order.currency}`} />
                    <Meta label="Live until" value={order.ends_at ? new Date(order.ends_at).toLocaleDateString() : "Not live yet"} />
                    <Meta label="Submitted" value={new Date(order.created_at).toLocaleDateString()} />
                  </dl>
                </div>

                <div className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-accent">
                        Slot {order.slot_id} · {order.duration_months}{" "}
                        {order.duration_months === 1 ? "month" : "months"}
                      </p>
                      <h2 className="mt-1 truncate text-[16px] font-semibold">{order.ad_name}</h2>
                    </div>
                    <div className="flex gap-1.5"><StatusBadge value={order.status} /><StatusBadge value={order.payment_status} /></div>
                  </div>

                  <div className="mt-4 grid gap-x-5 gap-y-3 text-[11px] sm:grid-cols-2">
                    <div>
                      <p className="text-ink-3">Advertiser</p>
                      <p className="mt-1 font-medium">{order.contact_name}{order.company_name ? ` · ${order.company_name}` : ""}</p>
                      <a href={`mailto:${order.email}`} className="mt-1 inline-flex items-center gap-1 break-all text-accent"><Mail aria-hidden className="h-3 w-3 shrink-0" />{order.email}</a>
                    </div>
                    <div>
                      <p className="text-ink-3">Order</p>
                      <p className="mt-1 font-medium">{money(order.amount_cents)} {order.currency} · PayPal</p>
                      <p className="mt-1 text-ink-3">Submitted {new Date(order.created_at).toLocaleString()}</p>
                    </div>
                    {order.about_advertiser ? (
                      <div className="sm:col-span-2"><p className="text-ink-3">About advertiser</p><p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink-2">{order.about_advertiser}</p></div>
                    ) : null}
                    <div className="sm:col-span-2"><p className="text-ink-3">Destination</p><a href={order.destination_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-accent">{order.destination_url}<ExternalLink aria-hidden className="h-3 w-3 shrink-0" /></a></div>
                    <div className="sm:col-span-2"><p className="text-ink-3">PayPal transaction ID</p><p className="mt-1 break-all font-mono text-[10.5px] text-ink-2">{order.paypal_transaction_id || "Not supplied — verify by amount, sender, and date in PayPal"}</p></div>
                  </div>

                  {order.status === "live" && (
                    <div className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-[10.5px] text-emerald-200/80">
                      Live until {order.ends_at ? new Date(order.ends_at).toLocaleString() : "—"}. {order.live_email_sent_at ? "Live confirmation email sent." : "Live confirmation email has not been recorded."}
                    </div>
                  )}

                  <AdOrderActions
                    id={order.id}
                    status={order.status}
                    paymentStatus={order.payment_status}
                    amountCents={order.amount_cents}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
