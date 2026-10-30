import Link from "next/link";
import { Megaphone } from "lucide-react";
import { loadInventory, slotBoardRows, type SlotBoardRow } from "@/lib/ads/inventory";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * One placement card, drawn exactly like the public ad slot: a 16:9 panel that
 * shows the running creative and its figures when it is sold, or the
 * “Advertise” artwork when it is open. No status pill and no placeholder
 * description text — the card itself shows which of the two states it is in.
 */
function SlotCard({ slot }: { slot: SlotBoardRow }) {
  const ad = slot.ad;
  const hasImage = Boolean(ad?.image_url);
  const canOpen = Boolean(ad?.destination_url);

  return (
    <article
      key={slot.id}
      aria-label={`Slot ${slot.id} — ${slot.label}`}
      className={`group relative overflow-hidden rounded-lg border bg-card ${
        slot.taken ? "border-line" : "border-accent/35"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black/40">
        {hasImage ? (
          canOpen ? (
            <a
              href={ad!.destination_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block h-full w-full"
              aria-label={`Open the live advertisement in slot ${slot.id}`}
            >
              <img
                src={ad!.image_url}
                alt={ad!.ad_name || `Advertisement in slot ${slot.id}`}
                className="h-full w-full object-cover transition group-hover:opacity-90"
                loading="lazy"
              />
            </a>
          ) : (
            <img
              src={ad!.image_url}
              alt={ad!.ad_name || `Advertisement in slot ${slot.id}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          )
        ) : slot.taken ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-[10px] text-ink-3">
            <span className="font-medium text-ink-2">Reserved</span>
            <span>{ad?.ad_name || "Historical campaign"}</span>
          </div>
        ) : (
          <Link
            href={`/checkout?slot=${slot.id}`}
            prefetch
            className="flex h-full flex-col items-center justify-center gap-1 transition hover:bg-card-hover"
            aria-label={`Advertise in slot ${slot.id}`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
              <Megaphone className="h-3.5 w-3.5 text-accent" strokeWidth={1.9} aria-hidden />
            </span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-200">Advertise</span>
            <span className="text-[10px] text-ink-3">{money(slot.price_cents)} · {slot.name}</span>
          </Link>
        )}

        <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-wider text-zinc-300 backdrop-blur">
          Slot {slot.id} · {slot.side}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line/70 px-3 py-2 text-[10.5px]">
        <span className="min-w-0 truncate text-ink-2">
          {slot.taken ? ad?.ad_name || "Reserved placement" : slot.name}
        </span>
        <span className="shrink-0 tabular-nums text-ink-3">
          {slot.taken
            ? ad?.ends_at
              ? `ends ${new Date(ad.ends_at).toLocaleDateString()}`
              : "in review"
            : money(slot.price_cents)}
        </span>
      </div>
    </article>
  );
}

export default async function AdSlotsAdmin() {
  let rows: SlotBoardRow[] = [];
  let error = "";
  try {
    rows = slotBoardRows(await loadInventory());
  } catch {
    error = "Unable to load ad slot inventory. Apply the latest database migration and try again.";
  }

  const left = rows.filter((slot) => slot.side === "left");
  const right = rows.filter((slot) => slot.side === "right");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">Ad Slots — Fixed Inventory (10)</h1>
          <p className="mt-1 max-w-[640px] text-[12px] leading-relaxed text-ink-3">
            The same five-and-five 16:9 rails the homepage renders. A sold placement shows its live
            creative; an open placement shows the “Advertise” card.
          </p>
        </div>
        <Link href="/admin/advertisements" className="rounded-md border border-line bg-pcard px-3 py-2 text-[11px] text-ink-2 hover:bg-white/5">
          Ad review
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-[12px] text-red-300">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-8 text-center text-[12px] text-ink-3">
          No placements could be read. Once the database is reachable, the ten fixed 16:9 slots are
          listed here with their live creative or the “Advertise” card.
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section aria-label="Left rail placements">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Left rail</h2>
            <span className="text-[10.5px] uppercase tracking-wider text-ink-3">Slots 1–{left.length}</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {left.map((slot) => <SlotCard key={slot.id} slot={slot} />)}
          </div>
        </section>

        <section aria-label="Right rail placements">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Right rail</h2>
            <span className="text-[10.5px] uppercase tracking-wider text-ink-3">
              Slots {left.length + 1}–{rows.length}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {right.map((slot) => <SlotCard key={slot.id} slot={slot} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
