import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutForm, { type CheckoutSlot } from "@/app/checkout/CheckoutForm";
import AdReviewNotice from "@/src/components/ads/AdReviewNotice";
import AdSlot from "@/src/components/AdSlot";
import { AD_REVIEW_FLAG_KEY } from "@/lib/ads/payment";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace, refresh: navigation.refresh }),
  usePathname: () => "/checkout",
}));

const assign = vi.fn();

const slots: CheckoutSlot[] = [
  { id: 1, name: "Left Sidebar Top", side: "left", position: 1, price_cents: 9900, status: "available", description: "Premium placement", available: true, ad: null },
  { id: 2, name: "Left Sidebar 2", side: "left", position: 2, price_cents: 9900, status: "available", description: "Second placement", available: true, ad: null },
  {
    id: 3,
    name: "Left Sidebar 3",
    side: "left",
    position: 3,
    price_cents: 9900,
    status: "available",
    description: "Third placement",
    available: false,
    ad: {
      image_url: "https://cdn.example.com/live-ad.png",
      ad_name: "Summer launch",
      destination_url: "https://example.com",
      ends_at: null,
      source: "order",
      live: true,
    },
  },
];

function tenSlots(): CheckoutSlot[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    name: `Placement ${index + 1}`,
    side: index < 5 ? "left" : "right",
    position: (index % 5) + 1,
    price_cents: 9900,
    status: "available",
    description: null,
    available: true,
    ad: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // jsdom cannot navigate; capture the PayPal hand-off instead.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { assign, href: "http://localhost/checkout", search: "" },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("guest advertising checkout", () => {
  it("links every vacant banner directly to its slot checkout", () => {
    render(<AdSlot index={3} />);
    expect(screen.getByRole("link", { name: /Advertise in slot 3/i })).toHaveAttribute("href", "/checkout?slot=3");
  });

  it("starts on Ads Details with the placements in a two-column, five-row grid and taken slots locked", () => {
    const { container } = render(<CheckoutForm slots={slots} />);
    expect(screen.getByRole("heading", { name: "1. Ads Details" })).toBeTruthy();
    const grid = container.querySelector('[data-slot-grid="5x2"]');
    expect(grid?.className).toContain("grid-cols-2");
    // Two columns at every breakpoint: ten placements read as five rows.
    expect(grid?.className).not.toContain("grid-cols-5");
    expect(grid?.className).not.toContain("sm:grid-cols-3");
    // Two available cards plus one locked, image-backed card.
    expect(screen.getAllByRole("button", { name: /Select ad slot/i })).toHaveLength(2);
    expect(screen.getByLabelText("Slot 3 is taken")).toBeTruthy();
    expect(screen.queryByLabelText("Slot 3 is taken")?.getAttribute("aria-disabled")).toBe("true");
    // No status pills on the placement cards.
    expect(screen.queryByText("Available")).toBeNull();
    expect(screen.queryByText("Taken")).toBeNull();
    expect(screen.getByAltText("Current advertisement in slot 3")).toHaveAttribute(
      "src",
      "https://cdn.example.com/live-ad.png",
    );
    // The fixed artwork panel replaced the old order-summary QR block.
    expect(screen.getByLabelText("Payment artwork")).toBeTruthy();
    expect(screen.queryByAltText("Erobabe PayPal payment QR code")).toBeNull();
  });

  it("scrolls the wizard in its own thin-scrollbar panel while the artwork panel stays fixed", () => {
    const { container } = render(<CheckoutForm slots={slots} />);
    const form = container.querySelector("form")!;
    const panel = container.querySelector("section.checkout-scroll") as HTMLElement;
    expect(panel).toBeTruthy();
    // The document no longer scrolls on desktop; the left panel does.
    expect(form.className).toContain("lg:h-screen");
    expect(form.className).toContain("lg:overflow-hidden");
    expect(panel.className).toContain("lg:h-screen");
    expect(panel.className).toContain("lg:overflow-y-auto");
    expect(panel.getAttribute("aria-label")).toBe("Checkout steps");
  });

  it("never renders more than ten placements", () => {
    render(<CheckoutForm slots={tenSlots()} />);
    expect(screen.getAllByRole("button", { name: /Select ad slot/i })).toHaveLength(10);
  });

  it("moves to Advertiser details when a slot is chosen, with destination URL second and highlighted", () => {
    render(<CheckoutForm slots={slots} />);
    fireEvent.click(screen.getByRole("button", { name: "Select ad slot 1 — 16:9 placement" }));
    expect(screen.getByRole("heading", { name: "2. Advertiser details" })).toBeTruthy();

    expect(screen.getByText("Media upload")).toBeTruthy();
    const destination = screen.getByPlaceholderText("https://your-website.com/landing-page");
    expect(destination).toHaveAttribute("required");
    // Highlighted wrapper: the field sits directly after the upload in an
    // accent-bordered block.
    expect(destination.closest("label")?.className).toContain("border-accent/45");
    expect(screen.getByText("Most important")).toBeTruthy();

    expect(screen.getByPlaceholderText("Alex Morgan")).toHaveAttribute("required");
    expect(screen.getByPlaceholderText("Your brand (optional)")).not.toHaveAttribute("required");
    expect(screen.getByPlaceholderText("you@company.com")).toHaveAttribute("required");
    expect(screen.getByPlaceholderText("e.g. Summer collection launch")).toHaveAttribute("required");
    expect(screen.getByPlaceholderText(/A sentence about your business/)).not.toHaveAttribute("required");
  });

  it("never mentions the payment provider or an approval queue on this page", () => {
    const { container } = render(<CheckoutForm slots={slots} />);
    // Step 1 → 2 → 3, then read every rendered word.
    fireEvent.click(screen.getByRole("button", { name: "Select ad slot 1 — 16:9 placement" }));
    fireEvent.change(screen.getByPlaceholderText("Alex Morgan"), { target: { value: "Alex Advertiser" } });
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Summer collection launch"), { target: { value: "Summer launch" } });
    fireEvent.change(screen.getByPlaceholderText("https://your-website.com/landing-page"), {
      target: { value: "https://example.com/offer" },
    });
    const file = new File(["png"], "banner.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[name="creative"]')!, { target: { files: [file] } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("heading", { name: "3. Payment" })).toBeTruthy();

    const words = (container.textContent || "").toLowerCase();
    expect(words).not.toContain("paypal");
    expect(words).not.toContain("in review");
    // The old explainer card is gone, not merely restyled.
    expect(screen.queryByText(/how payment works/i)).toBeNull();
    // …and the pay button says what it does.
    expect(screen.getByRole("button", { name: /Pay \$99\.00 Now/i })).toBeTruthy();
  });

  it("requires the banner before continuing, then submits and hands over to the payment page", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ orderId: "order-1", status: "in_review" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CheckoutForm slots={slots} />);

    fireEvent.click(screen.getByRole("button", { name: "Select ad slot 1 — 16:9 placement" }));
    fireEvent.change(screen.getByPlaceholderText("Alex Morgan"), { target: { value: "Alex Advertiser" } });
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Summer collection launch"), { target: { value: "Summer launch" } });
    fireEvent.change(screen.getByPlaceholderText("https://your-website.com/landing-page"), { target: { value: "https://example.com/offer" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByText(/Upload your 16:9 ad banner before continuing/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "3. Payment" })).toBeNull();

    const file = new File(["png"], "banner.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[name="creative"]')!, { target: { files: [file] } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("heading", { name: "3. Payment" })).toBeTruthy();
    expect(screen.getAllByText(/1 month/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Pay \$99\.00 Now/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://www.paypal.com/ncp/payment/AZP63KXT9FUNL"));

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(fetchMock).toHaveBeenCalledWith("/api/ads/submit", expect.objectContaining({ method: "POST" }));
    expect(body.get("slotId")).toBe("1");
    expect(body.get("durationMonths")).toBe("1");
    expect(body.get("adName")).toBe("Summer launch");
    expect(body.get("email")).toBe("alex@example.com");
    expect(body.get("destinationUrl")).toBe("https://example.com/offer");
    expect(body.get("creative")).toBe(file);

    // The homepage reads this flag to show the “In review” card once.
    expect(JSON.parse(window.localStorage.getItem(AD_REVIEW_FLAG_KEY) || "{}")).toMatchObject({
      orderId: "order-1",
      adName: "Summer launch",
    });
  });

  it("keeps the visitor on the payment step when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "This ad slot was just reserved." }, { status: 409 })));
    const { container } = render(<CheckoutForm slots={slots} initialSlot={1} />);
    fireEvent.change(screen.getByPlaceholderText("Alex Morgan"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Summer collection launch"), { target: { value: "Ad" } });
    fireEvent.change(screen.getByPlaceholderText("https://your-website.com/landing-page"), { target: { value: "https://example.com" } });
    fireEvent.change(container.querySelector('input[name="creative"]')!, {
      target: { files: [new File(["png"], "banner.png", { type: "image/png" })] },
    });
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.click(screen.getByRole("button", { name: /Pay \$99\.00 Now/i }));

    expect(await screen.findAllByText("This ad slot was just reserved.")).not.toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(AD_REVIEW_FLAG_KEY)).toBeNull();
  });

  it("opens directly on Advertiser details when the visitor came from a slot card", () => {
    render(<CheckoutForm slots={slots} initialSlot={2} />);
    expect(screen.getByRole("heading", { name: "2. Advertiser details" })).toBeTruthy();
    expect(screen.getByText(/Slot 2 · \$99\.00/)).toBeTruthy();
  });
});

describe("in-review confirmation", () => {
  it("shows the compact animated card and returns home after ten seconds", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(AD_REVIEW_FLAG_KEY, JSON.stringify({ at: Date.now(), orderId: "order-1" }));
    const { container } = render(<AdReviewNotice />);

    expect(screen.getByRole("heading", { name: "In review" })).toBeTruthy();
    expect(screen.getByText("We’re confirming your payment and checking your banner.")).toBeTruthy();
    expect(container.querySelector(".ad-review-in")).toBeTruthy();
    expect(container.querySelector(".ad-review-progress")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(9600);
    });
    expect(container.querySelector(".ad-review-out")).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(navigation.replace).toHaveBeenCalledWith("/");
    expect(window.localStorage.getItem(AD_REVIEW_FLAG_KEY)).toBeNull();
  });

  it("stays hidden when there is no pending review", () => {
    render(<AdReviewNotice />);
    expect(screen.queryByRole("heading", { name: "In review" })).toBeNull();
  });
});
