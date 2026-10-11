import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: vi.fn() } }),
}));

const SignInPage = (await import("@/app/auth/sign-in/page")).default;

describe("sign-in page presentation", () => {
  it("uses advertiser-only copy and a visible blurred background", () => {
    const { container } = render(<SignInPage />);

    expect(screen.getByText("Access advertiser portal")).toBeTruthy();
    expect(screen.queryByText("Access advertiser or admin portal")).toBeNull();
    expect(container.querySelector(".blur-3xl")).toBeTruthy();
    expect(screen.getByText("Access advertiser portal").parentElement?.className).toContain("bg-pcard/90");
  });
});
