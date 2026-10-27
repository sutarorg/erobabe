import { escapeHtml } from "@/lib/http/safety";
import { SITE_URL } from "@/lib/site";
import { Resend } from "resend";

let resendClient: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail(params: EmailParams) {
  const client = getResendClient();
  if (!client) {
    throw new Error("Resend not configured — missing RESEND_API_KEY");
  }

  const from =
    params.from || process.env.RESEND_FROM_EMAIL || "noreply@erobabe.com";

  const { data, error } = await client.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });

  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }

  return data;
}

// Templates matching Erobabe dark brand
export function templateCampaignSubmitted(email: string, campaignName: string) {
  return {
    to: email,
    subject: `Campaign "${campaignName}" received — under review`,
    html: `
      <div style="background:#0a0a0c;color:#f5f5f7;font-family:Inter,sans-serif;padding:32px">
        <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" style="height:24px" />
        <h1 style="color:#f5f5f7;font-size:20px;margin-top:16px">Campaign received</h1>
        <p style="color:#a1a1aa;font-size:14px">Your campaign <strong style="color:#f5f5f7">${escapeHtml(campaignName)}</strong> has been submitted and is awaiting payment and moderation.</p>
        <p style="color:#71717a;font-size:12px;margin-top:24px">This is an automated message from erobabe.</p>
      </div>
    `,
  };
}

export function templatePaymentConfirmed(
  email: string,
  campaignName: string,
  amount: string,
) {
  return {
    to: email,
    subject: `Payment confirmed for "${campaignName}"`,
    html: `
      <div style="background:#0a0a0c;color:#f5f5f7;font-family:Inter,sans-serif;padding:32px">
        <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" style="height:24px" />
        <h1 style="color:#f5f5f7;font-size:20px;margin-top:16px">Payment confirmed</h1>
        <p style="color:#a1a1aa;font-size:14px">We received ${escapeHtml(amount)} for campaign <strong style="color:#f5f5f7">${escapeHtml(campaignName)}</strong>. It will go live after creative approval.</p>
      </div>
    `,
  };
}

export function templateCampaignApproved(email: string, campaignName: string) {
  return {
    to: email,
    subject: `Campaign "${campaignName}" is now live`,
    html: `
      <div style="background:#0a0a0c;color:#f5f5f7;font-family:Inter,sans-serif;padding:32px">
        <h1 style="color:#f5f5f7">Campaign approved</h1>
        <p style="color:#a1a1aa">Your campaign <strong>${escapeHtml(campaignName)}</strong> is now active and delivering impressions.</p>
      </div>
    `,
  };
}

export function templateAdLive(
  email: string,
  adName: string,
  slotId: number,
  endsAt?: string | null,
) {
  const safeName = escapeHtml(adName);
  const expiry = endsAt
    ? `<p style="color:#a1a1aa;font-size:13px">Your placement runs until ${escapeHtml(new Date(endsAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }))}.</p>`
    : "";
  return {
    to: email,
    subject: "Your ad is live! Erobabe",
    text: `Your ad is live! Erobabe\n\n${adName} is now live in slot ${slotId}. View it at ${SITE_URL}.`,
    html: `
      <div style="background:#0a0a0c;color:#f5f5f7;font-family:Inter,Arial,sans-serif;padding:32px">
        <div style="max-width:560px;margin:0 auto;border:1px solid #242429;border-radius:16px;padding:28px;background:#151518">
          <p style="color:#f51655;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">erobabe advertising</p>
          <h1 style="color:#f5f5f7;font-size:25px;margin:12px 0">Your ad is live! Erobabe</h1>
          <p style="color:#a1a1aa;font-size:14px;line-height:1.6"><strong style="color:#f5f5f7">${safeName}</strong> has been approved and is now live in ad slot ${slotId}.</p>
          ${expiry}
          <a href="${SITE_URL}" style="display:inline-block;margin-top:14px;padding:12px 18px;border-radius:8px;background:#f51655;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700">View your ad</a>
          <p style="color:#71717a;font-size:11px;margin-top:26px">This is an automated message from erobabe.</p>
        </div>
      </div>
    `,
  };
}

export function templateCampaignRejected(
  email: string,
  campaignName: string,
  reason: string,
) {
  return {
    to: email,
    subject: `Campaign "${campaignName}" requires changes`,
    html: `
      <div style="background:#0a0a0c;color:#f5f5f7;font-family:Inter,sans-serif;padding:32px">
        <h1 style="color:#f5f5f7">Campaign needs attention</h1>
        <p style="color:#a1a1aa">Your campaign <strong>${escapeHtml(campaignName)}</strong> was not approved.</p>
        <p style="color:#a1a1aa">Reason: ${escapeHtml(reason)}</p>
      </div>
    `,
  };
}
