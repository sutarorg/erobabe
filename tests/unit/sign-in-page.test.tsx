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
  it("uses account-free advertising copy and keeps a visible blurred background", () => {
    const { container } = render(<SignInPage />);

    expect(screen.getByText("Sign in to your erobabe account")).toBeTruthy();
    expect(screen.queryByText(/advertiser portal/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /create advertiser/i })).toBeNull();
    expect(container.querySelector(".blur-3xl")).toBeTruthy();
    expect(screen.getByText("Sign in to your erobabe account").parentElement?.className).toContain("bg-pcard/90");
  });
});
