import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AgeGate from "@/src/components/AgeGate";

describe("public age gate", () => {
  it("asks on each fresh entry and closes only after explicit confirmation", () => {
    // Ignore legacy confirmations left by the old persistent age-gate behavior.
    localStorage.setItem("erobabe-age-verified", "previous-confirmation");
    const firstEntry = render(<AgeGate />);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, I am 18+" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, I am 18+" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(localStorage.getItem("erobabe-age-verified")).toBe("previous-confirmation");
    firstEntry.unmount();

    // A new mount represents a fresh entry to the public website. Confirmation
    // is deliberately not persisted in localStorage or sessionStorage.
    localStorage.clear();
    render(<AgeGate />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
