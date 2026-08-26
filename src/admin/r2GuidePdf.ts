/*
 * Generates the complete Cloudflare R2 setup guide as a branded PDF.
 * Kept client-side so no server credentials or configured backend are needed.
 */

type Pdf = import("jspdf").jsPDF;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 52;
const RIGHT = 52;
const TOP = 62;
const BOTTOM = 58;
const CONTENT_W = PAGE_W - LEFT - RIGHT;

const C = {
  ink: [18, 18, 23] as [number, number, number],
  muted: [96, 92, 102] as [number, number, number],
  rose: [244, 63, 127] as [number, number, number],
  violet: [124, 58, 237] as [number, number, number],
  line: [226, 223, 227] as [number, number, number],
  soft: [248, 246, 248] as [number, number, number],
  warning: [255, 247, 237] as [number, number, number],
  green: [22, 163, 74] as [number, number, number],
};

function safeText(value: string) {
  // Built-in PDF fonts are WinAnsi; normalize punctuation for predictable output.
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

class GuideWriter {
  doc: Pdf;
  y = TOP;

  constructor(doc: Pdf) {
    this.doc = doc;
  }

  newPage() {
    this.doc.addPage();
    this.y = TOP;
    this.pageHeader();
  }

  pageHeader() {
    const { doc } = this;
    doc.setFillColor(...C.ink);
    doc.rect(0, 0, PAGE_W, 34, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("EroBabe", LEFT, 22);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(208, 198, 207);
    doc.text("Cloudflare R2 Setup Guide", PAGE_W - RIGHT, 22, { align: "right" });
  }

  ensure(height: number) {
    if (this.y + height > PAGE_H - BOTTOM) this.newPage();
  }

  space(amount = 10) {
    this.y += amount;
  }

  heading(text: string, level: 1 | 2 | 3 = 2) {
    const { doc } = this;
    const size = level === 1 ? 22 : level === 2 ? 15 : 11;
    const before = level === 1 ? 18 : level === 2 ? 14 : 9;
    const after = level === 1 ? 10 : 7;
    this.ensure(size + before + after + 6);
    this.y += before;
    if (level === 2) {
      doc.setFillColor(...C.rose);
      doc.roundedRect(LEFT, this.y - 10, 4, 17, 2, 2, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...C.ink);
    doc.text(safeText(text), LEFT + (level === 2 ? 12 : 0), this.y);
    this.y += after + size * 0.45;
  }

  paragraph(text: string, options: { color?: [number, number, number]; size?: number; indent?: number } = {}) {
    const { doc } = this;
    const size = options.size ?? 9.5;
    const indent = options.indent ?? 0;
    const width = CONTENT_W - indent;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(options.color ?? C.ink));
    const lines = doc.splitTextToSize(safeText(text), width) as string[];
    const lineHeight = size * 1.48;
    this.ensure(lines.length * lineHeight + 4);
    doc.text(lines, LEFT + indent, this.y, { lineHeightFactor: 1.48 });
    this.y += lines.length * lineHeight + 5;
  }

  numbered(items: string[], start = 1) {
    const { doc } = this;
    items.forEach((raw, index) => {
      const n = `${start + index}.`;
      const text = safeText(raw);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.3);
      const lines = doc.splitTextToSize(text, CONTENT_W - 26) as string[];
      const h = Math.max(lines.length, 1) * 13.6 + 4;
      this.ensure(h);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.rose);
      doc.text(n, LEFT, this.y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...C.ink);
      doc.text(lines, LEFT + 25, this.y, { lineHeightFactor: 1.46 });
      this.y += h;
    });
  }

  bullets(items: string[]) {
    const { doc } = this;
    items.forEach((raw) => {
      const text = safeText(raw);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.3);
      const lines = doc.splitTextToSize(text, CONTENT_W - 25) as string[];
      const h = Math.max(lines.length, 1) * 13.6 + 3;
      this.ensure(h);
      doc.setFillColor(...C.rose);
      doc.circle(LEFT + 3, this.y - 2.5, 1.8, "F");
      doc.setTextColor(...C.ink);
      doc.text(lines, LEFT + 18, this.y, { lineHeightFactor: 1.46 });
      this.y += h;
    });
  }

  code(value: string) {
    const { doc } = this;
    const text = safeText(value);
    doc.setFont("courier", "normal");
    doc.setFontSize(8.1);
    const lines = doc.splitTextToSize(text, CONTENT_W - 24) as string[];
    const height = lines.length * 11.6 + 22;
    this.ensure(height + 5);
    doc.setFillColor(...C.ink);
    doc.roundedRect(LEFT, this.y - 8, CONTENT_W, height, 6, 6, "F");
    doc.setTextColor(245, 239, 244);
    doc.text(lines, LEFT + 12, this.y + 5, { lineHeightFactor: 1.43 });
    this.y += height + 7;
  }

  callout(title: string, body: string, kind: "note" | "warning" | "success" = "note") {
    const { doc } = this;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    const lines = doc.splitTextToSize(safeText(body), CONTENT_W - 32) as string[];
    const height = 31 + lines.length * 13;
    this.ensure(height + 6);
    const bg = kind === "warning" ? C.warning : kind === "success" ? [240, 253, 244] as [number, number, number] : C.soft;
    const accent = kind === "warning" ? [234, 88, 12] as [number, number, number] : kind === "success" ? C.green : C.violet;
    doc.setFillColor(...bg);
    doc.roundedRect(LEFT, this.y - 8, CONTENT_W, height, 6, 6, "F");
    doc.setFillColor(...accent);
    doc.roundedRect(LEFT, this.y - 8, 4, height, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...accent);
    doc.text(safeText(title), LEFT + 16, this.y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(...C.ink);
    doc.text(lines, LEFT + 16, this.y + 21, { lineHeightFactor: 1.47 });
    this.y += height + 7;
  }

  keyValue(key: string, source: string, example: string) {
    const { doc } = this;
    const sourceLines = doc.splitTextToSize(safeText(source), CONTENT_W - 186) as string[];
    const height = Math.max(48, 30 + sourceLines.length * 11);
    this.ensure(height + 5);
    doc.setDrawColor(...C.line);
    doc.setFillColor(253, 252, 253);
    doc.roundedRect(LEFT, this.y - 8, CONTENT_W, height, 6, 6, "FD");
    doc.setFont("courier", "bold");
    doc.setFontSize(8.4);
    doc.setTextColor(...C.rose);
    doc.text(key, LEFT + 12, this.y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...C.ink);
    doc.text(sourceLines, LEFT + 176, this.y + 7, { lineHeightFactor: 1.35 });
    doc.setFont("courier", "normal");
    doc.setFontSize(7.4);
    doc.setTextColor(...C.muted);
    doc.text(safeText(example), LEFT + 12, this.y + 25);
    this.y += height + 5;
  }
}

function addCover(doc: Pdf) {
  doc.setFillColor(...C.ink);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
  doc.setFillColor(...C.rose);
  doc.circle(PAGE_W - 35, 75, 115, "F");
  doc.setFillColor(...C.violet);
  doc.circle(PAGE_W - 5, 7, 82, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("EroBabe", LEFT, 72);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(251, 111, 168);
  doc.text("ADMIN CMS", LEFT + 67, 72);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(32);
  doc.setTextColor(255, 255, 255);
  doc.text("Cloudflare R2", LEFT, 196);
  doc.text("Setup Guide", LEFT, 235);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(202, 197, 204);
  doc.text("Every environment variable, click-by-click configuration,", LEFT, 275);
  doc.text("direct uploads, CORS, custom domains, and verification.", LEFT, 293);

  doc.setDrawColor(64, 61, 68);
  doc.line(LEFT, 345, PAGE_W - RIGHT, 345);

  doc.setFontSize(9.5);
  doc.setTextColor(174, 167, 177);
  const topics = [
    "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    "R2_BUCKET and R2_PUBLIC_BASE_URL",
    "PROCESSING_MODE and PROCESSING_WEBHOOK_SECRET",
    "SITE_URL, local environment, Vercel, and Netlify",
    "CORS, multipart upload checks, and troubleshooting",
  ];
  let y = 380;
  topics.forEach((topic) => {
    doc.setFillColor(...C.rose);
    doc.circle(LEFT + 3, y - 3, 2, "F");
    doc.text(topic, LEFT + 18, y);
    y += 25;
  });

  doc.setFontSize(8.5);
  doc.setTextColor(123, 118, 128);
  doc.text(`Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, LEFT, PAGE_H - 58);
  doc.text("18+ platform infrastructure documentation", PAGE_W - RIGHT, PAGE_H - 58, { align: "right" });
}

function addFooters(doc: Pdf) {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (p === 1) continue;
    doc.setDrawColor(...C.line);
    doc.line(LEFT, PAGE_H - 36, PAGE_W - RIGHT, PAGE_H - 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text("EroBabe - Cloudflare R2 Setup Guide", LEFT, PAGE_H - 22);
    doc.text(`${p - 1} / ${pages - 1}`, PAGE_W - RIGHT, PAGE_H - 22, { align: "right" });
  }
}

export async function downloadR2SetupGuide() {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const w = new GuideWriter(doc);

  addCover(doc);
  w.newPage();

  w.heading("1. What You Will Configure", 1);
  w.paragraph(
    "EroBabe stores videos and images in Cloudflare R2. The admin API creates short-lived signed upload URLs, and the browser uploads large files directly to R2. R2 credentials remain on the server. Published media is delivered through an R2 public development URL or, for production, media.erobabe.com."
  );
  w.callout(
    "Important architecture note",
    "Supabase stores metadata, statuses, categories, analytics, and settings. R2 stores media bytes. R2 does not replace Supabase, and Supabase Storage is not used by this project."
  );
  w.heading("Values covered by this guide", 2);
  w.keyValue("R2_ACCOUNT_ID", "Cloudflare account identifier, copied from the R2 S3 endpoint or dashboard URL.", 'R2_ACCOUNT_ID="0123456789abcdef0123456789abcdef"');
  w.keyValue("R2_ACCESS_KEY_ID", "Created once when you generate an R2 Object Read & Write API token.", 'R2_ACCESS_KEY_ID="..."');
  w.keyValue("R2_SECRET_ACCESS_KEY", "Created with the access key and shown only once. Store it immediately.", 'R2_SECRET_ACCESS_KEY="..."');
  w.keyValue("R2_BUCKET", "The exact bucket name you choose in R2.", 'R2_BUCKET="erobabe-media"');
  w.keyValue("R2_PUBLIC_BASE_URL", "The r2.dev test URL or production custom domain used to stream media.", 'R2_PUBLIC_BASE_URL="https://media.erobabe.com"');
  w.keyValue("PROCESSING_MODE", "A project setting you choose: original now, callback after configuring a transcoding worker.", 'PROCESSING_MODE="original"');
  w.keyValue("PROCESSING_WEBHOOK_SECRET", "A random secret generated locally for the optional processing callback.", 'PROCESSING_WEBHOOK_SECRET="64-random-hex-characters"');
  w.keyValue("SITE_URL", "The public frontend URL, without a trailing slash.", 'SITE_URL="https://erobabe.com"');

  w.heading("2. Create and Enable Cloudflare R2", 1);
  w.numbered([
    "Open https://dash.cloudflare.com and sign in or create a Cloudflare account.",
    "In the left navigation, open Storage & databases, then R2 Object Storage.",
    "Complete R2 onboarding. Cloudflare may request a billing profile even when your initial usage fits within the free allowance.",
    "Use the same Cloudflare account for the R2 bucket and, later, the erobabe.com DNS zone. A custom R2 domain must belong to a zone in the same account.",
  ]);
  w.callout(
    "Storage class",
    "Choose Standard storage for streaming video. Infrequent Access adds retrieval fees and a minimum storage duration and is generally unsuitable for frequently watched content.",
    "warning"
  );

  w.heading("3. Create the Bucket - R2_BUCKET", 1);
  w.numbered([
    "Open R2 Object Storage > Overview.",
    "Select Create bucket.",
    "Enter the bucket name erobabe-media. Bucket names are lowercase and cannot contain spaces.",
    "Select Standard as the default storage class.",
    "Leave location automatic unless you have a specific data-location requirement.",
    "Select Create bucket.",
  ]);
  w.code('R2_BUCKET="erobabe-media"');
  w.callout(
    "Keep the name exact",
    "The environment value must match the R2 bucket name character-for-character. Do not include a URL, slash, or folder name."
  );

  w.heading("4. Find the Account ID - R2_ACCOUNT_ID", 1);
  w.paragraph("Use either of these methods:");
  w.heading("Method A: S3 endpoint", 3);
  w.numbered([
    "Open R2 Object Storage > Overview.",
    "Find the S3 API endpoint. It resembles https://ACCOUNT_ID.r2.cloudflarestorage.com.",
    "Copy only the long ACCOUNT_ID portion, not the protocol or hostname suffix.",
  ]);
  w.code("S3 endpoint:\nhttps://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com\n\nEnvironment value:\nR2_ACCOUNT_ID=\"0123456789abcdef0123456789abcdef\"");
  w.heading("Method B: dashboard URL", 3);
  w.paragraph("While viewing R2, the browser address normally includes the account identifier immediately after dash.cloudflare.com/. Copy that identifier.");
  w.callout("Do not use a Zone ID", "Cloudflare also displays Zone IDs for websites. R2_ACCOUNT_ID must be the Cloudflare Account ID shown by the R2 S3 endpoint, not a DNS Zone ID.", "warning");

  w.heading("5. Create R2 API Credentials", 1);
  w.paragraph("This step provides R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.");
  w.numbered([
    "Return to R2 Object Storage > Overview.",
    "Find API Tokens and select Manage R2 API tokens.",
    "Select Create Account API token or Create User API token.",
    "Name the token EroBabe CMS Production.",
    "For permissions, select Object Read & Write.",
    "Choose Apply to specific buckets only and select erobabe-media.",
    "Leave Client IP filtering empty. Vercel and Netlify serverless function IP addresses can change.",
    "Create the token.",
    "On the confirmation page, copy Access Key ID and Secret Access Key immediately. Also confirm the S3 endpoint.",
  ]);
  w.code('R2_ACCESS_KEY_ID="paste-access-key-id"\nR2_SECRET_ACCESS_KEY="paste-secret-access-key"');
  w.callout(
    "Secret shown once",
    "Cloudflare does not show the Secret Access Key again. If it is lost, delete or rotate the token and create a new one. Never place either credential in a VITE_ variable, React code, Git, screenshots, or support messages.",
    "warning"
  );

  w.heading("6. Configure Public Playback - R2_PUBLIC_BASE_URL", 1);
  w.heading("Development: use r2.dev", 2);
  w.numbered([
    "Open R2 > erobabe-media > Settings.",
    "Find Public Development URL and select Enable or Allow Access.",
    "Type allow when Cloudflare asks for confirmation.",
    "Copy the generated https://pub-....r2.dev URL.",
    "Remove any trailing slash before storing it in the environment.",
  ]);
  w.code('R2_PUBLIC_BASE_URL="https://pub-xxxxxxxxxxxxxxxx.r2.dev"');
  w.callout(
    "Development only",
    "Cloudflare rate-limits r2.dev and may throttle bandwidth. It is suitable for testing, not production streaming. Do not create a CNAME pointing to r2.dev; Cloudflare documents that path as unsupported.",
    "warning"
  );

  w.heading("Production: connect media.erobabe.com", 2);
  w.numbered([
    "Purchase erobabe.com and add it as a Cloudflare website/zone in the same Cloudflare account as R2.",
    "At the registrar, change the nameservers to the values Cloudflare provides. Preserve or recreate the records required by Vercel or Netlify.",
    "Open R2 > erobabe-media > Settings > Custom Domains.",
    "Select Add and enter media.erobabe.com.",
    "Review the DNS record Cloudflare will create, then select Connect Domain.",
    "Wait for the status to change from Initializing to Active.",
    "Set R2_PUBLIC_BASE_URL to https://media.erobabe.com.",
    "After verifying playback, disable the r2.dev development URL.",
  ]);
  w.code('R2_PUBLIC_BASE_URL="https://media.erobabe.com"');

  w.heading("7. Configure CORS", 1);
  w.paragraph("CORS is mandatory because the admin browser sends direct PUT requests to R2. Without it, valid signed uploads are blocked by the browser.");
  w.numbered([
    "Open R2 > erobabe-media > Settings.",
    "Find CORS Policy and select Add CORS policy.",
    "Open the JSON editor.",
    "Paste the policy below, replacing temporary deployment origins with your exact URLs.",
    "Save and wait approximately 30 seconds for propagation.",
  ]);
  w.code(`[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:8888",
      "http://localhost:5173",
      "https://your-project.vercel.app",
      "https://your-site.netlify.app",
      "https://erobabe.com",
      "https://www.erobabe.com"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges"
    ],
    "MaxAgeSeconds": 3600
  }
]`);
  w.callout(
    "Origins must match exactly",
    "Use scheme://host[:port] only. Do not include a trailing slash or /admin path. Add each active Vercel or Netlify origin explicitly; do not rely on wildcard subdomains. ETag exposure is required to complete multipart uploads."
  );

  w.heading("8. Choose PROCESSING_MODE", 1);
  w.paragraph("PROCESSING_MODE is a setting you choose; Cloudflare does not provide this value.");
  w.heading("Recommended initial value: original", 2);
  w.code('PROCESSING_MODE="original"');
  w.bullets([
    "The uploaded MP4/WebM/MOV-compatible file is marked Ready after R2 finalizes it.",
    "Admin preview and public playback work immediately.",
    "No ffmpeg worker is needed.",
    "This does not create 360p, 480p, 720p, 1080p, or HLS renditions.",
  ]);
  w.heading("Later value: callback", 2);
  w.code('PROCESSING_MODE="callback"');
  w.bullets([
    "Use only after deploying a real transcoding worker or Cloudflare Stream bridge.",
    "Uploads remain in Processing until the worker calls the protected processing callback.",
    "The worker can return an HLS master playlist, rendition URLs, duration, and thumbnail URL.",
    "Switching to callback without a worker causes every new upload to remain stuck in Processing.",
  ]);

  w.heading("9. Generate PROCESSING_WEBHOOK_SECRET", 1);
  w.paragraph("This is another value you generate. It authenticates the optional transcoding callback. It is not an R2 token and should be different from SESSION_SECRET.");
  w.heading("macOS, Linux, or any machine with Node.js", 3);
  w.code(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
  w.heading("OpenSSL alternative", 3);
  w.code("openssl rand -hex 32");
  w.paragraph("Copy the 64-character hexadecimal output:");
  w.code('PROCESSING_WEBHOOK_SECRET="paste-64-random-hex-characters"');
  w.callout("Original mode", "The project does not call the processing webhook in original mode. You can still configure this secret now so it is ready for a future worker.");

  w.heading("10. Set SITE_URL", 1);
  w.paragraph("SITE_URL is the public address of the frontend. It is not generated by R2.");
  w.bullets([
    "Local Vercel development: http://localhost:3000",
    "Local Netlify development: http://localhost:8888",
    "Temporary Vercel deployment: https://your-project.vercel.app",
    "Temporary Netlify deployment: https://your-site.netlify.app",
    "Production: https://erobabe.com",
  ]);
  w.code('SITE_URL="https://erobabe.com"');
  w.callout("No trailing slash", "Use https://erobabe.com, not https://erobabe.com/. Update this value after connecting the purchased domain.");

  w.heading("11. Complete Environment File", 1);
  w.paragraph("Copy .env.example to .env at the project root, then fill in all values. The example below uses placeholders; never copy real secrets into documentation or source control.");
  w.code(`# Admin authentication
ADMIN_USERNAME="admin"
ADMIN_PASSWORD_SCRYPT="generated-scrypt-hash"
SESSION_SECRET="generated-session-secret"

# Supabase
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="server-only-service-role-key"

# Cloudflare R2
R2_ACCOUNT_ID="cloudflare-account-id"
R2_ACCESS_KEY_ID="r2-access-key-id"
R2_SECRET_ACCESS_KEY="r2-secret-access-key"
R2_BUCKET="erobabe-media"
R2_PUBLIC_BASE_URL="https://pub-xxxx.r2.dev"

# Processing
PROCESSING_MODE="original"
PROCESSING_WEBHOOK_SECRET="generated-64-character-secret"

# Frontend
SITE_URL="http://localhost:3000"`);
  w.callout(
    "Server-side variables only",
    "Do not rename these to VITE_R2_*. Vite exposes VITE_ variables in browser JavaScript. These values must only exist in .env locally and in Vercel/Netlify server environment settings.",
    "warning"
  );

  w.heading("12. Configure Vercel", 1);
  w.numbered([
    "Open the Vercel project.",
    "Select Settings > Environment Variables.",
    "Add every R2, processing, site, Supabase, and admin variable by its exact name.",
    "Enable Production. Enable Preview only if preview deployments should be able to upload media.",
    "Save the variables.",
    "Open Deployments and redeploy. Existing deployments do not automatically receive newly added environment values.",
    "Add the exact Vercel production origin to the R2 CORS policy until erobabe.com is active.",
  ]);

  w.heading("13. Configure Netlify", 1);
  w.numbered([
    "Open the Netlify site.",
    "Select Site configuration > Environment variables.",
    "Add every variable by its exact name and make it available to Functions.",
    "Save, then open Deploys and trigger a new deployment.",
    "Add the exact Netlify site origin to the R2 CORS policy until erobabe.com is active.",
  ]);

  w.heading("14. Run and Test Locally", 1);
  w.paragraph("Plain npm run dev serves the frontend but not the serverless API. Use one of the full-stack development commands:");
  w.code("npx vercel dev\n# Open http://localhost:3000/admin\n\n# OR\n\nnpx netlify dev\n# Open http://localhost:8888/admin");
  w.numbered([
    "Confirm the matching localhost origin is included in the R2 CORS policy.",
    "Sign in at /admin.",
    "Upload a small fictional/demo MP4 first.",
    "Wait for upload and finalization to complete.",
    "Add metadata and save it as a draft.",
    "Preview the stored video from the editor.",
    "Publish it and confirm it appears on the public homepage and watch route without a redeployment.",
  ]);

  w.heading("15. Verify Public Playback", 1);
  w.numbered([
    "Open Cloudflare R2 > erobabe-media > Objects.",
    "Locate the newly uploaded object under videos/.",
    "Append the exact object key to R2_PUBLIC_BASE_URL.",
    "Open the resulting URL in a private browser window. The video should load and support seeking.",
  ]);
  w.code("https://media.erobabe.com/videos/EXACT-OBJECT-KEY");
  w.paragraph("Check response headers with an allowed Origin header:");
  w.code(`curl -I \\
  -H "Origin: https://erobabe.com" \\
  "https://media.erobabe.com/videos/EXACT-OBJECT-KEY"`);
  w.bullets([
    "Expect Access-Control-Allow-Origin for the supplied origin.",
    "Expect Access-Control-Expose-Headers to include ETag and range-related headers.",
    "Expect Accept-Ranges: bytes for efficient video seeking.",
    "A curl request without an Origin header normally does not display CORS headers.",
  ]);

  w.heading("16. Verify Multipart Uploads", 1);
  w.numbered([
    "After a small upload succeeds, select a fictional/demo video larger than 64 MB.",
    "Open browser developer tools and select Network.",
    "Filter requests by r2.cloudflarestorage.com.",
    "Confirm multiple parallel PUT requests return HTTP 200.",
    "Open a part response and confirm JavaScript can read the ETag response header.",
    "Confirm the final /api/admin/uploads/VIDEO_ID/complete request succeeds.",
    "Confirm one completed object appears in R2 and the admin status becomes Ready in original mode.",
  ]);

  w.heading("17. Troubleshooting", 1);
  w.keyValue("Storage not configured", "One or more R2_* values is absent or misspelled in the server environment. Add it and redeploy/restart.", "Check all five R2 variables");
  w.keyValue("HTTP 403 from R2", "Check account ID, access key, secret, bucket name, token scope, whitespace, and system clock.", "Credentials or signature mismatch");
  w.keyValue("Browser CORS error", "Add the exact frontend origin, PUT method, allowed headers, and ETag exposure. Wait 30 seconds.", "Origin must have no trailing slash");
  w.keyValue("Multipart completion fails", "Inspect each PUT response. ETag must be present and exposed to browser JavaScript.", "ExposeHeaders must include ETag");
  w.keyValue("Uploaded file will not play", "Enable public access or the custom domain and verify R2_PUBLIC_BASE_URL contains no bucket path or trailing slash.", "Public playback URL is wrong/private");
  w.keyValue("r2.dev returns 429", "Move playback to media.erobabe.com. The development URL is intentionally rate-limited.", "Use a custom domain in production");
  w.keyValue("Video remains Processing", "PROCESSING_MODE is callback but no transcoding worker completed the callback.", "Use original until a worker exists");

  w.heading("18. Production Security Checklist", 1);
  w.bullets([
    "Restrict the R2 API token to Object Read & Write on erobabe-media only.",
    "Never commit .env, paste secrets into tickets, or expose credentials as VITE_ variables.",
    "Rotate the R2 token immediately if the access key or secret is exposed.",
    "Use a custom media domain for production; disable the r2.dev URL after verification.",
    "Remove localhost and temporary preview origins from production CORS when no longer needed.",
    "Keep draft metadata private. The current public-bucket architecture makes media retrievable by anyone who obtains its exact object URL, even before metadata is published.",
    "Use original processing mode until a real transcoding worker is deployed and monitored.",
    "Configure Cloudflare WAF/rate controls on your site and media domain as traffic grows, but do not place a login wall in front of public video playback.",
  ]);
  w.callout(
    "Setup complete",
    "After these checks pass, the flow is live: Sign in -> Upload directly to R2 -> Process -> Save as draft -> Preview -> Publish -> Automatically appear on EroBabe.",
    "success"
  );

  w.heading("Official Cloudflare Documentation", 2);
  w.bullets([
    "S3 API and credentials: https://developers.cloudflare.com/r2/get-started/s3/",
    "Public buckets and custom domains: https://developers.cloudflare.com/r2/buckets/public-buckets/",
    "CORS policies: https://developers.cloudflare.com/r2/buckets/cors/",
    "Upload objects and multipart details: https://developers.cloudflare.com/r2/objects/upload-objects/",
    "Platform limits: https://developers.cloudflare.com/r2/platform/limits/",
  ]);

  addFooters(doc);
  doc.setProperties({
    title: "EroBabe - Cloudflare R2 Setup Guide",
    subject: "Cloudflare R2, processing, and deployment environment configuration",
    author: "EroBabe",
    creator: "EroBabe Admin CMS",
    keywords: "Cloudflare R2, EroBabe, Vercel, Netlify, CORS, multipart upload",
  });
  doc.save("EroBabe-Cloudflare-R2-Setup-Guide.pdf");
}