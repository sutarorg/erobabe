import { Suspense, lazy, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

const AdminApp = lazy(() => import("@/admin/AdminApp"));
import { UiProvider, useUi } from "@/context/ui";
import { readStore, writeStore } from "@/hooks/store";
import { cn } from "@/lib/format";

import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { AgeGate } from "@/components/AgeGate";
import { Toaster } from "@/components/Feedback";
import { RouteLoading } from "@/components/Skeletons";

const Home = lazy(() => import("@/pages/Home"));
const Explore = lazy(() => import("@/pages/Explore"));
const Trending = lazy(() => import("@/pages/Trending"));
const Categories = lazy(() => import("@/pages/Categories"));
const CategoryPage = lazy(() => import("@/pages/CategoryPage"));
const Watch = lazy(() => import("@/pages/Watch"));
const SearchPage = lazy(() => import("@/pages/SearchPage"));
const History = lazy(() => import("@/pages/History"));
const Legal = lazy(() => import("@/pages/Legal"));
const ListPage = lazy(() => import("@/pages/ListPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

function Shell() {
  const { collapsed } = useUi();
  const location = useLocation();
  const [verified, setVerified] = useState(() => readStore<boolean>("eb:age-verified", false));

  const enter = () => {
    writeStore("eb:age-verified", true);
    setVerified(true);
  };

  // The admin CMS runs its own full-screen chrome (and its own auth),
  // bypassing the public layout and age gate.
  if (location.pathname.startsWith("/admin")) {
    return (
      <>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/admin/*" element={<AdminApp />} />
          </Routes>
        </Suspense>
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-screen">
      <ScrollToTop />
      <Header />
      <Sidebar />

      <main
        id="main"
        className={cn(
          "pt-14 transition-[padding] duration-300 md:pt-16",
          collapsed ? "lg:pl-[76px]" : "lg:pl-60"
        )}
      >
        <div className="min-h-[70vh] pb-20 lg:pb-8">
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/trending" element={<Trending />} />
              <Route path="/popular" element={<ListPage kind="popular" />} />
              <Route path="/new" element={<ListPage kind="new" />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/category/:slug" element={<CategoryPage />} />
              <Route path="/video/:id" element={<Watch />} />
              {/* Local-dev compatibility; production hosts 301 this to /video. */}
              <Route path="/watch/:id" element={<Watch />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/history" element={<History />} />
              <Route path="/legal/:topic" element={<Legal />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
        <Footer />
      </main>

      <BottomNav />
      <Toaster />

      {!verified && <AgeGate onEnter={enter} />}
    </div>
  );
}

export default function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  );
}
