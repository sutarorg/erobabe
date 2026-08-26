import { Link } from "react-router-dom";
import { Compass, Flame, Home } from "lucide-react";
import { useSEO } from "@/lib/seo";

export default function NotFound() {
  useSEO({
    title: "404 — Page Not Found — EroBabe",
    description: "The page you are looking for doesn't exist on EroBabe.",
    robots: "noindex",
  });
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-gradient select-none text-[110px] font-bold leading-none tracking-tight sm:text-[150px] animate-flicker">
        404
      </p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
        This room is empty
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-fog-500">
        The page you're looking for doesn't exist — it may have been moved, renamed or was never here at all.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
        >
          <Home className="size-4" aria-hidden />
          Back home
        </Link>
        <Link
          to="/trending"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/5 px-6 text-sm font-semibold text-fog-200 transition hover:bg-white/10 active:scale-95"
        >
          <Flame className="size-4" aria-hidden />
          Trending
        </Link>
        <Link
          to="/explore"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/5 px-6 text-sm font-semibold text-fog-200 transition hover:bg-white/10 active:scale-95"
        >
          <Compass className="size-4" aria-hidden />
          Explore
        </Link>
      </div>
    </div>
  );
}
