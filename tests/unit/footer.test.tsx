import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Footer from "@/src/components/Footer";

describe("public footer", () => {
  it("no longer advertises the admin portal", () => {
    render(<Footer onNavigate={vi.fn()} onAdvertise={vi.fn()} useLinks />);

    expect(screen.queryByRole("link", { name: /admin portal/i })).toBeNull();
    expect(screen.queryByText(/admin portal/i)).toBeNull();
  });

  it("keeps the information, support, and advertise links", () => {
    render(<Footer onNavigate={vi.fn()} onAdvertise={vi.fn()} useLinks />);

    for (const name of [/About Us/i, /Privacy Policy/i, /Terms of Service/i, /Contact Us/i, /FAQ/i, /Content Removal/i, /Advertise with us/i]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
  });
});
