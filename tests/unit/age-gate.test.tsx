import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AgeGate, { AGE_GATE_STORAGE_KEY } from "@/src/components/AgeGate";

beforeEach(() => {
  localStorage.clear();
});

describe("public age gate", () => {
  it("asks on the very first visit and only closes after explicit confirmation", () => {
    render(<AgeGate />);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, I am 18+" })).toBeTruthy();
    expect(localStorage.getItem(AGE_GATE_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Yes, I am 18+" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("remembers the confirmation so it is shown only once", () => {
    const firstVisit = render(<AgeGate />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, I am 18+" }));
    expect(localStorage.getItem(AGE_GATE_STORAGE_KEY)).toBeTruthy();

    firstVisit.unmount();

    // A later page load / return visit must not be gated again.
    render(<AgeGate />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Yes, I am 18+" })).toBeNull();
  });

  it("still asks when the stored confirmation is missing", () => {
    localStorage.removeItem(AGE_GATE_STORAGE_KEY);

    render(<AgeGate />);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
