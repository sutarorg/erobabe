import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const navigation = vi.hoisted(() => ({ pathname: "/video/first" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

import WatchTransition, { WatchSkeleton } from "@/src/components/watch/WatchTransition";

function Page() {
  return (
    <WatchTransition>
      <h1>First clip</h1>
      <a href="/video/second">Second clip</a>
      <a href="/video/first">This clip</a>
      <a href="/category/asian">A category</a>
      <a href="/video/third" target="_blank">
        New tab
      </a>
    </WatchTransition>
  );
}

afterEach(() => {
  cleanup();
  navigation.pathname = "/video/first";
});

describe("switching to another video", () => {
  it("replaces the page the moment another video is clicked", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Second clip" }));

    // The old page — and with it the player — is gone before the new route
    // resolves, so the click is acknowledged immediately.
    expect(screen.queryByRole("heading", { name: "First clip" })).toBeNull();
    expect(screen.getByText("Loading video…")).toBeTruthy();
  });

  it("keeps the page when the click is not a switch", () => {
    render(<Page />);

    fireEvent.click(screen.getByRole("link", { name: "This clip" }));
    expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "A category" }));
    expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "New tab" }));
    expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();
  });

  it("leaves modifier clicks to the browser", () => {
    render(<Page />);
    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(screen.getByRole("link", { name: "Second clip" }), modifier);
      expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();
    }
  });

  it("ignores clicks on player chrome", () => {
    render(
      <WatchTransition>
        <button type="button">Play</button>
        <span data-testid="surface">video surface</span>
      </WatchTransition>,
    );
    fireEvent.click(screen.getByText("video surface"));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByText("video surface")).toBeTruthy();
  });

  it("restores the page once the destination has rendered", () => {
    const { rerender } = render(<Page />);
    fireEvent.click(screen.getByRole("link", { name: "Second clip" }));
    expect(screen.getByText("Loading video…")).toBeTruthy();

    navigation.pathname = "/video/second";
    rerender(<Page />);
    expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();
  });

  it("gives up on a navigation that never completes", () => {
    vi.useFakeTimers();
    try {
      render(<Page />);
      fireEvent.click(screen.getByRole("link", { name: "Second clip" }));
      expect(screen.getByText("Loading video…")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getByRole("heading", { name: "First clip" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("watch skeleton", () => {
  it("reserves the player's shape and announces itself", () => {
    const { container } = render(<WatchSkeleton />);
    expect(screen.getByText("Loading video…")).toBeTruthy();
    expect(container.querySelector(".aspect-video")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
  });
});
