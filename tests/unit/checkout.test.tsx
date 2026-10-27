import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutForm, { type CheckoutSlot } from "@/app/checkout/CheckoutForm";
import ReviewRedirect from "@/app/checkout/review/ReviewRedirect";
import AdSlot from "@/src/components/AdSlot";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

const slots: CheckoutSlot[] = [
  { id: 1, name: "Left Sidebar Top", side: "left", position: 1, price_cents: 9900, status: "available", description: "Premium placement", available: true },
  { id: 2, name: "Left Sidebar 2", side: "left", position: 2, price_cents: 9900, status: "available", description: "Second placement", available: true },
];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("guest PayPal checkout", () => {
  it("links every vacant banner directly to its slot checkout", () => {
    render(<AdSlot index={3} />);
    expect(screen.getByRole("link", { name: /Advertise in slot 3/i })).toHaveAttribute("href", "/checkout?slot=3");
  });

  it("renders the split layout, local PayPal QR, selected slot, and Submit action", () => {
    const { container } = render(<CheckoutForm slots={slots} initialSlot={1} />);
    expect(container.querySelector("form")?.className).toContain("lg:grid-cols-2");
    expect(screen.getByAltText("Erobabe PayPal payment QR code")).toHaveAttribute("src", "/paypal-qr.png");
    expect(screen.getByDisplayValue("Slot 1 — Left Sidebar Top")).toBeTruthy();
    expect(screen.getByText(/No account or advertiser dashboard needed/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    expect(screen.getAllByText("$99.00").length).toBeGreaterThan(0);
  });

  it("submits advertiser details, payment confirmation, and banner to the guest API", async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ orderId: "order-1", status: "in_review" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CheckoutForm slots={slots} initialSlot={1} />);

    fireEvent.change(screen.getByPlaceholderText("Alex Morgan"), { target: { value: "Alex Advertiser" } });
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Summer collection launch"), { target: { value: "Summer launch" } });
    fireEvent.change(screen.getByPlaceholderText("https://your-website.com/landing-page"), { target: { value: "https://example.com/offer" } });
    fireEvent.change(screen.getByPlaceholderText(/Briefly describe your business/), { target: { value: "An independent retailer promoting a seasonal offer." } });
    fireEvent.change(screen.getByPlaceholderText("Helps us find your payment"), { target: { value: "PAYPAL-123" } });

    const file = new File(["png"], "banner.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[name="creative"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm that I have sent/i }));
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/checkout/review"));
    expect(fetchMock).toHaveBeenCalledWith("/api/ads/submit", expect.objectContaining({ method: "POST" }));
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("slotId")).toBe("1");
    expect(body.get("adName")).toBe("Summer launch");
    expect(body.get("email")).toBe("alex@example.com");
    expect(body.get("paypalTransactionId")).toBe("PAYPAL-123");
    expect(body.get("paymentConfirmed")).toBe("true");
    expect(body.get("creative")).toBe(file);
  });

  it("keeps the visitor on checkout when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "This ad slot was just reserved." }, { status: 409 })));
    const { container } = render(<CheckoutForm slots={slots} initialSlot={1} />);
    fireEvent.change(container.querySelector('input[name="creative"]')!, {
      target: { files: [new File(["png"], "banner.png", { type: "image/png" })] },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findAllByText("This ad slot was just reserved.")).not.toHaveLength(0);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});

describe("in-review confirmation", () => {
  it("shows an animated review state and returns to the public site after five seconds", () => {
    vi.useFakeTimers();
    const { container } = render(<ReviewRedirect />);
    expect(screen.getByRole("heading", { name: "In review" })).toBeTruthy();
    expect(container.querySelector(".review-progress")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(navigation.replace).toHaveBeenCalledWith("/");
  });
});
