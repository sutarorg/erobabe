import { compareCryptoAmounts, type NowpaymentsPayment } from "./client";

/** Keep provider quotes bounded and representable by the settlement comparator. */
export function validQuoteAmount(amount: string | null): boolean {
  return (
    !!amount &&
    /^[0-9]{1,40}(\.[0-9]{1,18})?$/.test(amount) &&
    Number(amount) > 0
  );
}

/** Shared by first checkout and recovery; neither may expose an unrelated quote. */
export function matchesNowpaymentsQuote(
  quote: NowpaymentsPayment,
  expected: { orderId: string; payCurrency: string; priceCents: number },
): boolean {
  return (
    typeof expected.orderId === "string" &&
    expected.orderId.length > 0 &&
    expected.orderId.length <= 200 &&
    typeof expected.payCurrency === "string" &&
    /^[a-z0-9]{2,32}$/i.test(expected.payCurrency) &&
    /^[0-9]{1,40}$/.test(quote.paymentId) &&
    !!quote.payAddress &&
    quote.payAddress.length <= 512 &&
    !/\s/.test(quote.payAddress) &&
    validQuoteAmount(quote.payAmount) &&
    Number.isSafeInteger(expected.priceCents) &&
    expected.priceCents > 0 &&
    quote.orderId === expected.orderId &&
    quote.payCurrency?.toLowerCase() === expected.payCurrency.toLowerCase() &&
    quote.priceCurrency?.toLowerCase() === "usd" &&
    validQuoteAmount(quote.priceAmount) &&
    compareCryptoAmounts(
      quote.priceAmount,
      (expected.priceCents / 100).toFixed(2),
      0,
    ) === "match"
  );
}
