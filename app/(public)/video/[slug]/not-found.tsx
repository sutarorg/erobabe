import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-[16px] font-semibold">Video not found</p>
      <p className="mt-1 text-[12.5px] text-ink-3">This scene may have been removed or the link is incorrect.</p>
      <Link href="/" className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft">
        Back to home
      </Link>
    </div>
  );
}
