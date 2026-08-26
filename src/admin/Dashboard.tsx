import { Film, HardDrive, Hourglass, UploadCloud, Users, Eye, BarChart3, Clock, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { BarsChart, BtnLink, EmptyBlock, PageHeader, Spinner, StatCard, useFetch, fmtViews } from "./ui";
import { fmtBytes } from "./uploader";

export default function Dashboard() {
  const { data, loading, error } = useFetch(() => api.overview(), []);

  if (loading) return <Spinner label="Loading overview…" />;
  if (error || !data) {
    return (
      <div className="px-1 pt-10">
        <EmptyBlock
          title="Couldn't load the dashboard"
          body={error ?? "Check that environment variables are set (see README)."}
          action={<BtnLink to="/admin/settings" variant="subtle">Open settings</BtnLink>}
        />
      </div>
    );
  }

  const t = data.totals;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub="Content, storage and audience at a glance."
        actions={<BtnLink to="/admin/upload" variant="primary" icon={UploadCloud}>Upload video</BtnLink>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Film} label="Videos" value={String(t.videos)} sub={`${t.objects} objects`} accent />
        <StatCard icon={CheckCircle2} label="Published" value={String(t.published)} sub={`${t.drafts} in draft`} />
        <StatCard icon={Hourglass} label="Processing" value={String(t.processing)} sub="uploading + processing" />
        <StatCard icon={Eye} label="Lifetime views" value={fmtViews(t.views)} sub="tracked plays" />
        <StatCard icon={HardDrive} label="Storage used" value={fmtBytes(t.storageBytes)} sub="tracked originals" />
        <StatCard icon={BarChart3} label="Views (14d)" value={fmtViews(data.series.reduce((n, d) => n + d.views, 0))} sub="last two weeks" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Views — last 14 days</h2>
            <BtnLink to="/admin/analytics" variant="ghost" size="sm">Details</BtnLink>
          </div>
          <BarsChart data={data.series} />
        </div>

        <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Top videos</h2>
          {data.topVideos.length === 0 ? (
            <p className="py-8 text-center text-xs text-fog-600">No published videos yet.</p>
          ) : (
            <ol className="space-y-3">
              {data.topVideos.map((v, i) => (
                <li key={v.id}>
                  <Link to={`/admin/videos/${v.id}`} className="group flex items-center gap-3">
                    <span className="w-5 text-center text-sm font-bold text-fog-600">{i + 1}</span>
                    <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-ink-800 ring-1 ring-white/8">
                      {v.thumbnail_url && (
                        <img src={v.thumbnail_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fog-100 group-hover:text-brand-300">{v.title}</p>
                      <p className="text-xs text-fog-600">{fmtViews(v.views)} views</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent activity</h2>
          <BtnLink to="/admin/analytics" variant="ghost" size="sm">Full log</BtnLink>
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-xs text-fog-600"><Clock className="size-3.5" /> No activity yet — uploads, publishes and edits appear here.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.recentActivity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/5 text-fog-500"><Users className="size-3.5" aria-hidden /></span>
                <p className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-fog-200">{a.actor}</span>{" "}
                  <span className="text-fog-500">{a.action.replace(/\./g, " · ")}</span>{" "}
                  {typeof a.meta?.title === "string" && <span className="text-fog-300">“{a.meta.title}”</span>}
                </p>
                <span className="shrink-0 text-[11px] text-fog-600">{new Date(a.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
