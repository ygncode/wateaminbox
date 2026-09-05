import { escapeHtml } from "./security.js";
import { env } from "./env.js";

const BRAND_NAME = "WATeamInbox";
const BRAND_TAGLINE = "Shared WhatsApp inbox for teams";
const SUPPORT_EMAIL = "hello@wateaminbox.com";

export interface EmailDetail {
  label: string;
  value: string;
}

export interface BrandedEmailContent {
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  action?: {
    label: string;
    url: string;
  };
  details?: EmailDetail[];
  callout?: {
    label?: string;
    text: string;
  };
  note?: string;
}

/** Keep customer-controlled values on one bounded, email-header-safe line. */
export function emailHeaderText(value: string, fallback = "workspace"): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 80) || fallback;
}

function paragraph(value: string): string {
  return `<p style="margin:0 0 18px;color:#34413a;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:16px;line-height:1.65;">${escapeHtml(value)}</p>`;
}

function detailRows(details: EmailDetail[]): string {
  return details
    .map(
      ({ label, value }) => `
        <tr>
          <td style="padding:8px 12px;color:#64716a;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;line-height:1.45;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;color:#243129;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:1.45;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");
}

/**
 * Email-client-safe branded shell. Layout uses presentation tables and inline
 * styles so the message remains coherent in conservative clients.
 */
export function renderBrandedEmail(content: BrandedEmailContent): string {
  const logoUrl = escapeHtml(new URL("/favicon-96x96.png", env.APP_URL).toString());
  const action = content.action;
  const actionUrl = action ? escapeHtml(action.url) : "";
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px;background:#f3f6f4;border:1px solid #dfe6e1;border-radius:8px;">${detailRows(content.details)}</table>`
    : "";
  const callout = content.callout
    ? `<div style="margin:4px 0 22px;padding:16px 18px;background:#f3f6f4;border-left:4px solid #258556;border-radius:4px;">
        ${content.callout.label ? `<p style="margin:0 0 8px;color:#64716a;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.08em;line-height:1.4;text-transform:uppercase;">${escapeHtml(content.callout.label)}</p>` : ""}
        <p style="margin:0;color:#243129;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:15px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(content.callout.text)}</p>
      </div>`
    : "";
  const actionBlock = action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 22px;">
        <tr>
          <td align="center" bgcolor="#1f7a4c" style="border-radius:7px;">
            <a href="${actionUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;">${escapeHtml(action.label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 18px;color:#68756e;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;line-height:1.55;">If the button does not work, copy and paste this address into your browser:<br><a href="${actionUrl}" style="color:#1f7a4c;text-decoration:underline;word-break:break-all;">${actionUrl}</a></p>`
    : "";
  const note = content.note
    ? `<p style="margin:24px 0 0;padding-top:20px;color:#68756e;border-top:1px solid #e4e9e5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;line-height:1.55;">${escapeHtml(content.note)}</p>`
    : "";

  return `<!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light">
      <meta name="supported-color-schemes" content="light">
      <title>${escapeHtml(content.title)}</title>
    </head>
    <body style="margin:0;padding:0;background:#f2f5f3;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0;padding:0;background:#f2f5f3;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dfe5e1;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 30px;background:#173d2c;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="48" style="width:48px;vertical-align:middle;padding-right:12px;"><img src="${logoUrl}" width="40" height="40" alt="WAT" style="display:block;width:40px;height:40px;border:0;border-radius:10px;"></td>
                    <td style="color:#ffffff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:17px;font-weight:700;letter-spacing:-0.01em;vertical-align:middle;">${BRAND_NAME}</td>
                    <td align="right" style="color:#a9d6bb;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;">${escapeHtml(content.eyebrow)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:38px 34px 34px;">
                <h1 style="margin:0 0 20px;color:#1d2922;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:400;letter-spacing:-0.02em;line-height:1.2;">${escapeHtml(content.title)}</h1>
                ${content.paragraphs.map(paragraph).join("")}
                ${details}
                ${callout}
                ${actionBlock}
                ${note}
              </td>
            </tr>
          </table>
          <p style="margin:18px auto 0;color:#748078;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:12px;line-height:1.6;">${BRAND_NAME} · ${BRAND_TAGLINE}<br>Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#526b5b;text-decoration:underline;">${SUPPORT_EMAIL}</a></p>
        </td>
      </tr>
    </table>
    </body>
    </html>`;
}

export function renderPlainTextEmail(content: BrandedEmailContent): string {
  const parts = [content.title, ...content.paragraphs];
  if (content.details?.length) {
    parts.push(
      content.details
        .map(({ label, value }) => `${label}: ${value}`)
        .join("\n"),
    );
  }
  if (content.callout) {
    parts.push(
      [content.callout.label, content.callout.text].filter(Boolean).join("\n"),
    );
  }
  if (content.action)
    parts.push(`${content.action.label}: ${content.action.url}`);
  if (content.note) parts.push(content.note);
  parts.push(`—\n${BRAND_NAME}\n${BRAND_TAGLINE}\nSupport: ${SUPPORT_EMAIL}`);
  return parts.join("\n\n");
}
