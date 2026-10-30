import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import MobileAdsProvider from "@/src/components/ads/MobileAdsProvider";
import MobileAdSlot from "@/src/components/ads/MobileAdSlot";
import MobileAdBreak from "@/src/components/ads/MobileAdBreak";
import { mobileRotationPool } from "@/app/(public)/PublicLayoutClient";
import type { RotatableAd } from "@/lib/ads/rotation";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/",
}));

function ad(id: string): RotatableAd {
  return {
    id,
    title: `Creative ${id}`,
    image_url: `https://cdn.example.com/${id}.png`,
    destination_url: `https://example.com/${id}`,
  };
}

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBanners(ads: RotatableAd[], count: number) {
  return render(
    <MobileAdsProvider ads={ads}>
      {Array.from({ length: count }, (_, index) => (
        <MobileAdSlot key={index} position={index} inGrid />
      ))}
    </MobileAdsProvider>,
  );
}

describe("mobile ad banners", () => {
  it("shows the plain advertise card when no ad is active", () => {
    const { container } = renderBanners([], 2);
    expect(screen.getAllByRole("link", { name: /Advertise on erobabe/i })).toHaveLength(2);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    // Desktop hides every mobile banner — the rails take over from 1000px.
    expect(container.firstElementChild?.className).toContain("min-[1000px]:hidden");
  });

  it("prints a faded 'Advertise with us' link under every banner and no corner tag", () => {
    const { container } = renderBanners([ad("only")], 3);
    const links = screen.getAllByRole("link", { name: "Advertise with us" });
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/checkout");
      expect(link.className).toContain("underline");
      // Faded but legible: the brighter secondary ink, not the dimmest one.
      expect(link.className).toContain("text-ink-2/90");
      expect(link.className).not.toContain("opacity-75");
    }
    // The top-right “Advertisement” label is gone from the mobile card.
    expect(screen.queryByText("Advertisement")).toBeNull();
    expect(container.querySelectorAll("[data-mobile-ad]")).toHaveLength(3);
  });

  it("shows the single active ad in every banner position", () => {
    renderBanners([ad("only")], 4);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(4);
    expect(new Set(images.map((image) => image.getAttribute("src")))).toEqual(
      new Set(["https://cdn.example.com/only.png"]),
    );
  });

  it("rotates a multi-ad pool so no creative owns the first banner", () => {
    const pool = [ad("a"), ad("b"), ad("c"), ad("d")];
    renderBanners(pool, 4);
    const sources = screen.getAllByRole("img").map((image) => image.getAttribute("src"));
    expect(new Set(sources).size).toBe(4);
  });

  it("builds the rotation pool from the same active creatives the rails use", () => {
    const pool = mobileRotationPool([
      {
        campaign_id: "campaign-1",
        slot_id: 1,
        creative: {
          id: "creative-1",
          title: "Summer launch",
          image_url: "https://cdn.example.com/a.png",
          destination_url: "https://example.com/a",
          status: "approved",
        },
      },
      {
        slot_id: 2,
        creative: {
          id: "creative-2",
          title: "No destination",
          image_url: "https://cdn.example.com/b.png",
          destination_url: "",
          status: "approved",
        },
      },
    ]);
    expect(pool).toEqual([
      {
        id: "creative-1",
        campaign_id: "campaign-1",
        title: "Summer launch",
        image_url: "https://cdn.example.com/a.png",
        destination_url: "https://example.com/a",
      },
    ]);
  });
});

describe("mobile ad break", () => {
  it("covers every third video, waits three seconds, then closes to that video", () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem("erobabe:mobile-video-opens", "2");

    const { container } = render(
      <MobileAdsProvider ads={[ad("only")]}>
        <MobileAdBreak slug="midnight-velvet" />
      </MobileAdsProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Advertisement break" })).toBeTruthy();
    // The ad-break placement carries the same checkout link …
    expect(screen.getByRole("link", { name: "Advertise with us" })).toHaveAttribute("href", "/checkout");
    // … and no countdown caption under the slot: the timer lives in the corner
    // counter only.
    expect(screen.getByLabelText("Close button appears in 3 seconds")).toBeTruthy();
    expect(screen.queryByText(/Your video starts in/i)).toBeNull();
    expect(screen.queryByText(/Continue to your video/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Close advertisement" })).toBeNull();

    // One tick per act(): the next countdown timer is scheduled after React
    // commits the new second.
    for (let tick = 0; tick < 3; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    const close = screen.getByRole("button", { name: "Close advertisement" });
    expect(close.className).toContain("ad-break-close");
    expect(window.sessionStorage.getItem("erobabe:mobile-video-opens")).toBe("3");

    fireEvent.click(close);
    expect(navigation.push).toHaveBeenCalledWith("/video/midnight-velvet");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    vi.useRealTimers();
  });

  it("does not interrupt the first two videos or any desktop visit", () => {
    window.sessionStorage.setItem("erobabe:mobile-video-opens", "0");
    const first = render(
      <MobileAdsProvider ads={[ad("only")]}>
        <MobileAdBreak slug="one" />
      </MobileAdsProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();

    window.sessionStorage.setItem("erobabe:mobile-video-opens", "2");
    stubMatchMedia(false);
    render(
      <MobileAdsProvider ads={[ad("only")]}>
        <MobileAdBreak slug="three" />
      </MobileAdsProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
