import Link from "next/link";
import { AlertTriangle, DatabaseZap, Lock, SearchX } from "lucide-react";
import type { ReactNode } from "react";

const TONES = {
  empty: { icon: SearchX, ring: "border-line bg-pcard", iconClass: "text-ink-3" },
  info: { icon: DatabaseZap, ring: "border-sky-500/25 bg-sky-500/5", iconClass: "text-sky-300" },
  error: { icon: AlertTriangle, ring: "border-amber-500/25 bg-amber-500/5", iconClass: "text-amber-300" },
  forbidden: { icon: Lock, ring: "border-red-500/25 bg-red-500/5", iconClass: "text-red-300" },
} as const;

/**
 * The states a report can be in that are not "here is the data": nothing
 * recorded, the migration is missing, the service role is not allowed, or the
 * request failed. Each one says what is wrong and what to do about it — none of
 * them invent a number.
 */
export default function StatePanel({
  tone = "empty",
  title,
  body,
  children,
}: {
  tone?: keyof typeof TONES;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const { icon: Icon, ring, iconClass } = TONES[tone];
  return (
    <div className={`rounded-lg border p-6 text-center ${ring}`}>
      <Icon aria-hidden className={`mx-auto h-5 w-5 ${iconClass}`} />
      <p className="mt-2 text-[13px] font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-[520px] text-[12px] leading-relaxed text-ink-3">{body}</p>}
      {children && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

/** The "nothing recorded yet" panel, with the one action that fixes it. */
export function EmptyTraffic() {
  return (
    <StatePanel
      title="No traffic recorded in this range"
      body="Pageviews are collected in the browser on the public website. Open the site in a normal browser window (not a preview bot) and browse a few pages, then reload this report — the first numbers appear within a minute."
    />
  );
}

/** The permission panel used when the service role cannot read analytics. */
export function PermissionDenied() {
  return (
    <StatePanel
      tone="forbidden"
      title="You do not have access to analytics"
      body="This report is restricted to active staff accounts. Sign in with an administrator account, or ask an operator to check your profile role."
    >
      <Link href="/admin/signin" className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">
        Sign in
      </Link>
      <Link href="/admin" className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-2">
        Back to dashboard
      </Link>
    </StatePanel>
  );
}

/** Maps a loader status onto the panel an operator should see. */
export function AnalyticsState({
  status,
  message,
}: {
  status: "unconfigured" | "unavailable" | "forbidden" | "error";
  message?: string;
}) {
  if (status === "unconfigured") {
    return (
      <StatePanel
        tone="info"
        title="Analytics storage is not configured"
        body="Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the deployment environment, apply migration 00000000000028_analytics.sql, then reload this page."
      />
    );
  }
  if (status === "forbidden") return <PermissionDenied />;
  if (status === "unavailable") {
    return (
      <StatePanel
        tone="error"
        title="Analytics tables are missing"
        body={message || "Apply migration 00000000000028_analytics.sql to this database and reload."}
      />
    );
  }
  return (
    <StatePanel
      tone="error"
      title="Analytics could not be loaded"
      body={message || "The report request failed. Try again in a moment; the reason is in the server logs."}
    />
  );
}
