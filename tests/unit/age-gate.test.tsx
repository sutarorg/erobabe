import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AgeGate from "@/src/components/AgeGate";

const STORAGE_KEY = "erobabe-age-verified";

beforeEach(() => {
  localStorage.clear();
});

describe("public age gate", () => {
  it("does not skip a fresh entry based on an old localStorage confirmation", () => {
    localStorage.setItem(STORAGE_KEY, "1");

    render(<AgeGate />);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, I am 18+" })).toBeTruthy();
  });

  it("only closes after explicit confirmation and asks again on the next mount", () => {
    const firstEntry = render(<AgeGate />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, I am 18+" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    firstEntry.unmount();
    render(<AgeGate />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
