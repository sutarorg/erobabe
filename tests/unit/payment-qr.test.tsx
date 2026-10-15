import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { buildPaymentUri, encodeQrCodeMatrix } from "@/src/utils/paymentQr";
import InlineAd from "@/src/components/InlineAd";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
      }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({
          data: { publicUrl: "https://cdn.example.com/ad.jpg" },
        }),
      }),
    },
    from: (table: string) => ({
      insert: () => ({
        select: async () => ({
          data:
            table === "ad_creatives"
              ? [{ id: "creative-1", slot_id: 1 }]
              : [{ id: "campaign-1" }],
          error: null,
        }),
      }),
      delete: () => ({
        in: async () => ({ error: null }),
      }),
    }),
  }),
}));

import NewCampaignPage from "@/app/advertiser/campaigns/new/page";

describe("payment QR code and advertiser checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("encodes an EIP-681 USDT on Ethereum transfer URI with the payable amount", () => {
    const uri = buildPaymentUri({
      payAddress: "0x1111111111111111111111111111111111111111",
      payAmount: "99.5",
      payCurrency: "usdterc20",
      network: "Ethereum (ERC-20)",
    });
    expect(uri).toBe(
      "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0x1111111111111111111111111111111111111111&uint256=99500000",
    );

    const matrix = encodeQrCodeMatrix(uri);
    expect(matrix.length).toBeGreaterThanOrEqual(29);
    expect(matrix[0]?.length).toBe(matrix.length);
  });

  it("removes the payment asset & network selector, defaults to USDT on Ethereum, and renders a payment QR code at checkout", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/advertiser/slots") {
        return Response.json({
          slots: [
            {
              id: 1,
              name: "Left 1",
              side: "left",
              position: 1,
              price_cents: 9900,
              status: "active",
              description: null,
              available: true,
            },
          ],
        });
      }
      if (url === "/api/nowpayments/create") {
        const body = JSON.parse(String(options?.body || "{}"));
        expect(body.paymentCurrency).toBe("USDT");
        expect(body.chain).toBe("ethereum");
        return Response.json({
          paymentId: "pay-123",
          address: "0x1111111111111111111111111111111111111111",
          amount: "99.5",
          priceUSD: "99.00",
          paymentCurrency: "USDT",
          chain: "ethereum",
          network: "Ethereum",
          slotIds: [1],
          invoiceNumber: "INV-001",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
      }
      return Response.json({ state: "awaiting_payment" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NewCampaignPage />);

    await waitFor(() =>
      expect(screen.getByText(/Slot 1 — Left 1/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Payment asset & network/i)).toBeNull();

    fireEvent.click(screen.getByText(/Slot 1 — Left 1/i));
    fireEvent.change(screen.getByPlaceholderText("e.g. Winter launch"), {
      target: { value: "Autumn Promo" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("https://your-landing-page.com"),
      {
        target: { value: "https://example.com" },
      },
    );
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["img"], "banner.jpg", { type: "image/jpeg" })],
      },
    });

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(screen.getByText("Complete payment")).toBeTruthy(),
    );

    const qrSection = screen.getByTestId("payment-qr-section");
    expect(qrSection.getAttribute("data-payable-amount")).toBe("99.5");
    expect(qrSection.getAttribute("data-payment-uri")).toContain(
      "uint256=99500000",
    );
    expect(
      screen.getByRole("img", {
        name: /Payment QR code for 99\.5 USDT/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Payable amount: 99\.5 USDT \(\$99\.00 USD\)/i),
    ).toBeTruthy();
  });

  it("shows no ad slot banners on mobile via InlineAd", () => {
    const { container } = render(<InlineAd />);
    expect(container.firstChild).toBeNull();
  });
});
