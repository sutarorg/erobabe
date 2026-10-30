import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

const push = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ value: "/admin/analytics" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname.value,
  useSearchParams: () => new URLSearchParams("range=7d"),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

import DataTable, { type TableColumn } from "@/src/components/analytics/DataTable";
import TimeSeriesChart from "@/src/components/analytics/TimeSeriesChart";
import AdSeriesChart from "@/src/components/analytics/AdSeriesChart";
import BreakdownList from "@/src/components/analytics/BreakdownList";
import RangePicker from "@/src/components/analytics/RangePicker";
import AnalyticsTabs, { activeTab } from "@/src/components/analytics/AnalyticsTabs";
import KpiCard from "@/src/components/analytics/KpiCard";
import { parseAnalyticsRange } from "@/lib/analytics/range";

afterEach(() => {
  cleanup();
  push.mockClear();
});

const columns: TableColumn[] = [
  { key: "page", label: "Page", kind: "text" },
  { key: "views", label: "Pageviews", kind: "number" },
];

const rows = Array.from({ length: 12 }, (_, index) => ({
  id: `r${index}`,
  page: `/page-${index}`,
  views: index * 10,
}));

describe("DataTable", () => {
  it("sorts by a column and flips direction on a second click", () => {
    render(<DataTable columns={columns} rows={rows} caption="Pages" initialSort={{ key: "views", direction: "desc" }} />);
    const table = screen.getByRole("table", { name: "Pages" });
    const visiblePages = () =>
      Array.from(table.querySelectorAll("tbody tr")).map((row) => row.querySelector("td")?.textContent);

    expect(visiblePages()[0]).toBe("/page-11");

    fireEvent.click(within(table).getByRole("button", { name: /pageviews/i }));
    expect(visiblePages()[0]).toBe("/page-0");

    const header = within(table).getAllByRole("columnheader")[1];
    expect(header.getAttribute("aria-sort")).toBe("ascending");
  });

  it("paginates and reports the visible slice", () => {
    render(<DataTable columns={columns} rows={rows} caption="Pages" defaultPageSize={10} />);
    expect(screen.getByText("1–10 of 12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(screen.getByText("11–12 of 12")).toBeTruthy();
    // The last page cannot go further.
    expect((screen.getByRole("button", { name: /next page/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders row links, a CSV link and an empty label", () => {
    render(
      <DataTable
        columns={[{ key: "page", label: "Page", kind: "text", linkKey: "href" }, columns[1]]}
        rows={[{ id: "a", page: "Latest", href: "/admin/analytics/pages/latest", views: 5 }]}
        caption="Pages"
        csvHref="/api/admin/analytics/export?section=traffic"
      />,
    );
    expect(screen.getByRole("link", { name: "Latest" }).getAttribute("href")).toBe(
      "/admin/analytics/pages/latest",
    );
    expect(screen.getByRole("link", { name: /csv/i }).getAttribute("href")).toContain("section=traffic");

    cleanup();
    render(<DataTable columns={columns} rows={[]} caption="Pages" emptyLabel="No pages yet" />);
    expect(screen.getByText("No pages yet")).toBeTruthy();
  });
});

describe("TimeSeriesChart", () => {
  const points = [
    { bucket: "2026-10-24T00:00:00.000Z", pageviews: 10, sessions: 4, visitors: 3, engagedSeconds: 20 },
    { bucket: "2026-10-25T00:00:00.000Z", pageviews: 30, sessions: 8, visitors: 6, engagedSeconds: 40 },
  ];

  it("renders an accessible chart plus a hidden table of exact values", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    expect(screen.getByRole("img", { name: /2 days of pageviews/i })).toBeTruthy();
    const table = screen.getByRole("table", { name: /traffic over time/i });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Oct 25")).toBeTruthy();
  });

  it("lets an operator turn series on and off", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const visitors = screen.getByRole("button", { name: /visitors/i });
    expect(visitors.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(visitors);
    expect(visitors.getAttribute("aria-pressed")).toBe("true");
  });

  it("says so when there is nothing to plot", () => {
    render(<TimeSeriesChart points={[]} bucket="day" />);
    expect(screen.getByText("No traffic recorded in this range")).toBeTruthy();
  });
});

describe("AdSeriesChart", () => {
  it("renders delivery columns and a hidden data table", () => {
    render(
      <AdSeriesChart
        points={[
          { bucket: "2026-10-24T00:00:00.000Z", impressions: 100, clicks: 2 },
          { bucket: "2026-10-25T00:00:00.000Z", impressions: 300, clicks: 4 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /400 impressions and 6 clicks/i })).toBeTruthy();
  });

  it("explains an empty delivery window", () => {
    render(<AdSeriesChart points={[]} />);
    expect(screen.getByText("No impressions or clicks recorded in this range")).toBeTruthy();
  });
});

describe("KPI cards and breakdowns", () => {
  it("renders a delta with its direction and text", () => {
    render(<KpiCard label="Pageviews" value="1,200" delta={0.25} comparedTo="vs previous period" />);
    expect(screen.getByText("Pageviews")).toBeTruthy();
    expect(screen.getByText("1,200")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
    expect(screen.getByText("vs previous period")).toBeTruthy();
  });

  it("says when there is no baseline to compare with", () => {
    render(<KpiCard label="Sessions" value="0" delta={null} comparedTo="vs previous period" />);
    expect(screen.getByText("no prior data")).toBeTruthy();
  });

  it("links KPI cards when a drill-down exists", () => {
    render(<KpiCard label="Revenue" value="$99.00" href="/admin/analytics/advertising" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/admin/analytics/advertising");
  });

  it("renders a ranked breakdown with shares and links", () => {
    render(
      <BreakdownList
        rows={[
          { key: "/latest", label: "Latest", pageviews: 100, sessions: 50, visitors: 40, engagedSeconds: 10, share: 0.5 },
          { key: "/", label: "Home", pageviews: 60, sessions: 25, visitors: 20, engagedSeconds: 5, share: 0.25 },
        ]}
        hrefFor={(row) => `/admin/analytics/pages${row.key}`}
      />,
    );
    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Latest/ }).getAttribute("href")).toBe("/admin/analytics/pages/latest");
  });

  it("renders the empty breakdown state", () => {
    render(<BreakdownList rows={[]} emptyLabel="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});

describe("RangePicker", () => {
  const range = parseAnalyticsRange({ range: "7d" }, new Date("2026-10-30T09:15:00.000Z"));

  it("marks the active preset and links the others", () => {
    render(<RangePicker range={range} />);
    const active = screen.getByRole("link", { name: "Last 7 days" });
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.getAttribute("href")).toContain("range=7d");
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("href")).toContain("range=today");
    expect(screen.getByText(range.label)).toBeTruthy();
  });

  it("submits a custom range through the router", () => {
    render(<RangePicker range={range} />);
    fireEvent.click(screen.getByRole("button", { name: /custom/i }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledWith(
      "/admin/analytics?range=custom&from=2026-10-01&to=2026-10-05",
    );
  });

  it("warns when a hostile range was clamped or unusable", () => {
    const clamped = parseAnalyticsRange(
      { range: "custom", from: "2025-01-01", to: "2026-10-01" },
      new Date("2026-10-30T09:15:00.000Z"),
    );
    render(<RangePicker range={clamped} />);
    expect(screen.getByRole("note")).toHaveTextContent(/capped at 90 days/i);
  });
});

describe("AnalyticsTabs", () => {
  it("highlights the section that owns the route, including drill-downs", () => {
    expect(activeTab("/admin/analytics")).toBe("/admin/analytics");
    expect(activeTab("/admin/analytics/traffic")).toBe("/admin/analytics/traffic");
    expect(activeTab("/admin/analytics/advertising/abc")).toBe("/admin/analytics/advertising");
    expect(activeTab("/admin/analytics/pages/latest")).toBe("/admin/analytics");
  });

  it("renders one link per report", () => {
    pathname.value = "/admin/analytics/audience";
    render(<AnalyticsTabs />);
    const nav = screen.getByRole("navigation", { name: "Analytics sections" });
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    expect(within(nav).getByRole("link", { name: "Audience" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("stateful smoke", () => {
  it("keeps the table usable while the surrounding page re-renders", () => {
    function Harness() {
      const [count, setCount] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            {count}
          </button>
          <DataTable columns={columns} rows={rows.slice(0, 3)} caption="Pages" />
        </div>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(screen.getByRole("button", { name: "1" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Pages" })).toBeTruthy();
  });
});
