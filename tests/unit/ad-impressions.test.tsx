import { it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import AdSlot from "@/src/components/AdSlot";
let notify: (entries: Partial<IntersectionObserverEntry>[]) => void;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("records only a loaded image continuously 50% visible for a second; clicks carry verified identifiers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof notify) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  const { getByRole } = render(
    <AdSlot
      index={1}
      campaignId="11111111-1111-4111-8111-111111111111"
      creative={{
        id: "22222222-2222-4222-8222-222222222222",
        image_url: "https://example.com/ad.png",
        destination_url: "https://example.com",
        title: "Fixture",
      }}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.load(getByRole("img"));
  act(() => {
    notify([{ intersectionRatio: 0.5 }]);
    vi.advanceTimersByTime(900);
    notify([{ intersectionRatio: 0 }]);
    vi.advanceTimersByTime(2000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    notify([{ intersectionRatio: 1 }]);
    vi.advanceTimersByTime(1000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/track/impression");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    slotId: 1,
    creativeId: "22222222-2222-4222-8222-222222222222",
    campaignId: "11111111-1111-4111-8111-111111111111",
  });
  fireEvent.click(getByRole("link"));
  expect(fetchMock.mock.calls[1][0]).toBe("/api/track/click");
});
