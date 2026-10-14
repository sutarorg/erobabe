import React from "react";
/** Legacy standalone shell delegates to the real, authenticated App Router workflow. */
export function UploadView() {
  return <section className="p-6"><h1>Upload videos</h1><p>Device uploads are available in the authenticated admin dashboard.</p><a href="/admin/videos/upload">Open video uploads</a></section>;
}
export default UploadView;
