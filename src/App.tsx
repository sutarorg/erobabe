import { useCallback, useEffect, useState } from "react";
import AdminApp from "./admin/AdminApp";
import PortalApp from "./portal/PortalApp";
import PublicSite from "./PublicSite";

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

/**
 * Erobabe product shell — three frontend-only surfaces sharing one brand:
 *   #/admin                    Admin Portal (default)
 *   #/advertise                Advertiser Portal
 *   #/site                     Public streaming website
 *   #/site/video/{slug}        Public watch page
 *   #/site/categories|latest   Public index pages
 *   #/site/about|terms|privacy|contact|faq|removal   Static pages
 */
export default function App() {
  const hash = useHash();
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const go = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  const root = parts[0] ?? "admin";
  if (root === "advertise") {
    return (
      <PortalApp
        path={parts.slice(1).join("/")}
        onRoute={(p) => go(p ? `/advertise/${p}` : "/advertise")}
        onExit={() => go("/site")}
      />
    );
  }
  if (root === "site") {
    return (
      <PublicSite
        path={parts.slice(1).join("/")}
        onRoute={(p) => go(p ? `/site/${p}` : "/site")}
        onAdvertise={() => go("/advertise")}
        onAdmin={() => go("/admin")}
      />
    );
  }
  return <AdminApp onSite={() => go("/site")} onAdvertise={() => go("/advertise")} />;
}
