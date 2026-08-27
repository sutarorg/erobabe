/**
 * EroBabe — root router. Public experience + lazy-loaded admin CMS.
 */
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PublicLayout } from "./components/chrome";
import HomePage from "./pages/home";
import TrendingPage from "./pages/trending";
import WatchPage from "./pages/watch";
import {
  CategoriesPage, CategoryPage, ExplorePage, HistoryPage, LegalPage,
  ListingPage, NotFoundPage, SearchPage,
} from "./pages/browse";

const AdminApp = lazy(() => import("./admin/AdminApp"));

function AdminFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-eb-950">
      <div className="flex flex-col items-center gap-4">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-eb-rose border-t-transparent" />
        <p className="text-xs tracking-widest text-eb-faint uppercase">Loading studio…</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="explore" element={<ExplorePage />} />
          <Route path="trending" element={<TrendingPage />} />
          <Route path="popular" element={<ListingPage kind="popular" />} />
          <Route path="new" element={<ListingPage kind="new" />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="category/:slug" element={<CategoryPage />} />
          <Route path="watch/:id" element={<WatchPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="legal/:page" element={<LegalPage />} />
          <Route path="legal" element={<Navigate to="/legal/about" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<AdminFallback />}>
              <AdminApp />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
