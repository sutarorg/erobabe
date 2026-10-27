import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { buildPaymentUri, encodeQrCodeMatrix } from "@/src/utils/paymentQr";
import InlineAd from "@/src/components/InlineAd";

describe("legacy payment QR utility and mobile ad placement", () => {
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

  it("shows no ad slot banners on mobile via InlineAd", () => {
    const { container } = render(<InlineAd />);
    expect(container.firstChild).toBeNull();
  });
});
