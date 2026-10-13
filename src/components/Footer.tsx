"use client";
import Link from "next/link";
import { LOGO_URL } from "../data/content";
import { NAV_HREFS, type NavKey } from "./Header";

interface FooterProps {
  onNavigate: (key: NavKey) => void;
  onOpenPage?: (path: string) => void;
  onAdvertise?: () => void;
  useLinks?: boolean;
}

const EXPLORE_LINKS: { label: string; key: NavKey }[] = [
  { label: "Categories", key: "categories" },
  { label: "Latest Videos", key: "latest" },
  { label: "Top Rated", key: "toprated" },
];

const INFO_LINKS: { label: string; path: string; href: string }[] = [
  { label: "About Us", path: "about", href: "/about" },
  { label: "Privacy Policy", path: "privacy", href: "/privacy" },
  { label: "Terms of Service", path: "terms", href: "/terms" },
];

const SUPPORT_LINKS: { label: string; path: string; href: string }[] = [
  { label: "Contact Us", path: "contact", href: "/contact" },
  { label: "FAQ", path: "faq", href: "/faq" },
  { label: "Content Removal", path: "removal", href: "/content-removal" },
];

function LinkColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-2">
        {title}
      </h3>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

const linkClass =
  "w-fit text-[12.5px] text-ink-3 transition-colors duration-150 hover:text-accent";

export default function Footer({ onNavigate, onOpenPage, onAdvertise, useLinks = false }: FooterProps) {
  return (
    <footer className="mt-10 border-t border-line">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 @sm:px-5 @2xl:px-7">
        <div className="grid gap-8 @lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2">
              <img
                src={LOGO_URL}
                alt="erobabe logo"
                className="h-6 w-auto object-contain"
                draggable={false}
              />
              <span className="text-[14px] font-bold tracking-tight text-ink">
                erobabe<span className="text-accent">.</span>
              </span>
            </div>
            <p className="mt-2.5 max-w-[250px] text-[12px] leading-relaxed text-ink-3">
              Your destination for discovering premium adult entertainment.
            </p>
          </div>

          <LinkColumn title="Explore">
            {EXPLORE_LINKS.map((link) => (
              <li key={link.label}>
                {useLinks ? (
                  <Link href={NAV_HREFS[link.key]} prefetch className={linkClass}>
                    {link.label}
                  </Link>
                ) : (
                  <button type="button" onClick={() => onNavigate(link.key)} className={linkClass}>
                    {link.label}
                  </button>
                )}
              </li>
            ))}
          </LinkColumn>

          <LinkColumn title="Information">
            {INFO_LINKS.map((link) => (
              <li key={link.path}>
                {useLinks ? (
                  <Link href={link.href} prefetch className={linkClass}>
                    {link.label}
                  </Link>
                ) : (
                  <button type="button" onClick={() => onOpenPage?.(link.path)} className={linkClass}>
                    {link.label}
                  </button>
                )}
              </li>
            ))}
          </LinkColumn>

          <LinkColumn title="Support">
            {SUPPORT_LINKS.map((link) => (
              <li key={link.path}>
                {useLinks ? (
                  <Link href={link.href} prefetch className={linkClass}>
                    {link.label}
                  </Link>
                ) : (
                  <button type="button" onClick={() => onOpenPage?.(link.path)} className={linkClass}>
                    {link.label}
                  </button>
                )}
              </li>
            ))}
            {onAdvertise && (
              <li>
                {useLinks ? (
                  <Link href="/advertiser" prefetch className={linkClass}>
                    Advertise with us
                  </Link>
                ) : (
                  <button type="button" onClick={onAdvertise} className={linkClass}>
                    Advertise with us
                  </button>
                )}
              </li>
            )}
          </LinkColumn>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-[11.5px] text-ink-3">
            © 2026 erobabe. All rights reserved.
          </p>
          <span className="inline-flex items-center rounded border border-accent/45 bg-accent/8 px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-accent">
            18+ ADULTS ONLY
          </span>
        </div>
      </div>
    </footer>
  );
}
