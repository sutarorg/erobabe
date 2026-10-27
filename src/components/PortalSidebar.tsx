"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogOut, Menu, X } from "lucide-react";
export default function PortalSidebar({
  portal,
  email,
  children,
}: {
  portal: "Admin";
  email: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const path = usePathname();
  function close() {
    dialog.current?.close();
    setOpen(false);
  }
  useEffect(() => {
    dialog.current?.close();
    setOpen(false);
  }, [path]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const change = () => {
      if (media.matches) {
        dialog.current?.close();
        setOpen(false);
      }
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const content = (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <img
          src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png"
          alt="erobabe"
          className="h-6 w-auto"
        />
        <span className="text-[10px] font-semibold uppercase tracking-[.2em] text-accent">
          {portal}
        </span>
      </div>
      {children}
      <div className="shrink-0 border-t border-line p-3 text-xs">
        <p className="truncate px-3 py-2 text-ink-3" title={email}>
          {email}
        </p>
        <form action="/auth/sign-out" method="post">
          <button className="flex min-h-10 w-full items-center gap-2 rounded px-3 text-left hover:bg-white/5">
            <LogOut aria-hidden className="h-4 w-4" />
            Sign out
          </button>
        </form>
        <Link
          href="/"
          className="mt-2 flex min-h-10 items-center gap-2 border-t border-line px-3 text-ink-3"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Public site
        </Link>
      </div>
    </div>
  );
  return (
    <>
      <aside className="hidden h-full w-60 shrink-0 border-r border-line bg-psidebar lg:block">
        {content}
      </aside>
      <button
        ref={trigger}
        type="button"
        aria-label={`Open ${portal.toLowerCase()} navigation`}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        className="fixed left-3 top-3 z-30 rounded border border-line bg-psidebar p-2.5 lg:hidden"
      >
        <Menu aria-hidden className="h-5 w-5" />
      </button>
      <dialog
        ref={dialog}
        aria-label={`${portal} menu`}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[90vw] border-r border-line bg-psidebar p-0 text-ink backdrop:bg-black/70 lg:hidden"
      >
        {open && (
          <>
            <button
              aria-label="Close navigation"
              onClick={close}
              className="absolute right-2 top-2 z-10 rounded bg-psidebar p-2"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            <div
              className="h-full"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) close();
              }}
            >
              {content}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
