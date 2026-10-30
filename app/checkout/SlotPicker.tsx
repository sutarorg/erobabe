"use client";

import type { InventorySlot } from "@/lib/ads/inventory";
import VacantAdCard from "@/src/components/ads/VacantAdCard";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/**
 * Step 1 of the checkout wizard: the ten fixed placements, drawn exactly like
 * the homepage ad cards.
 *
 * Two columns and five rows on every breakpoint, so the whole inventory is
 * read top-to-bottom: ten placements always fill exactly five rows.
 *
 * An unsold placement is a selectable “Advertise” card; a sold one shows the
 * running creative and is not selectable. Choosing an available card moves the
 * wizard straight to the advertiser step.
 */
export default function SlotPicker({
  slots,
  onSelect,
}: {
  slots: InventorySlot[];
  onSelect: (slot: InventorySlot) => void;
}) {
  if (!slots.length) {
    return (
      <p className="mt-5 rounded-lg border border-dashed border-line p-5 text-[12px] leading-relaxed text-ink-3">
        No ad slots are available right now. Please check back soon.
      </p>
    );
  }

  return (
    <div
      className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4"
      data-slot-grid="5x2"
    >
      {slots.map((slot) => (
        <div key={slot.id} className="min-w-0">
          {slot.available ? (
            <VacantAdCard
              slotId={slot.id}
              emphasize
              compact
              tag="Available"
              label="Advertise"
              className="aspect-video w-full"
              onSelect={() => onSelect(slot)}
            />
          ) : (
            <div
              aria-label={`Slot ${slot.id} is taken`}
              aria-disabled="true"
              title={slot.ad?.ad_name ? `Taken: ${slot.ad.ad_name}` : "This slot is taken"}
              className="relative aspect-video w-full cursor-not-allowed overflow-hidden rounded-lg border border-line bg-card"
            >
              {slot.ad?.image_url ? (
                <img
                  src={slot.ad.image_url}
                  alt={`Current advertisement in slot ${slot.id}`}
                  className="h-full w-full object-cover opacity-55"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-ink-3">
                  Reserved
                </span>
              )}
              <span className="absolute left-1.5 top-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-wider text-emerald-300">
                Taken
              </span>
            </div>
          )}
          <p className="mt-1 truncate text-center text-[9.5px] tabular-nums text-ink-3">
            Slot {slot.id} · {money(slot.price_cents)}
          </p>
        </div>
      ))}
    </div>
  );
}
