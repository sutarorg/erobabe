import { track } from "@/lib/ads/track";
export async function POST(req: Request) {
  return track(req, "click");
}
