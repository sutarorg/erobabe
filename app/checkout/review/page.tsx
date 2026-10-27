import type { Metadata } from "next";
import ReviewRedirect from "./ReviewRedirect";

export const metadata: Metadata = {
  title: "Ad in review — erobabe",
  robots: { index: false, follow: false },
};

export default function AdReviewPage() {
  return <ReviewRedirect />;
}
