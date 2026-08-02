function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function confirmationEmail(confirmationUrl: string): {
  html: string;
  subject: string;
  text: string;
} {
  const safeUrl = escapeHtml(confirmationUrl);

  return {
    subject: "Confirm your WATeamInbox Cloud waitlist spot",
    text: `Confirm your place on the WATeamInbox Cloud waitlist:\n\n${confirmationUrl}\n\nThis link expires in three days. If you did not request this, you can safely ignore this email.\n\nWATeamInbox remains open source and self-hostable.`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f5f4ed;color:#15211f;font-family:ui-sans-serif,system-ui,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d8ddd6;">
          <tr><td style="padding:32px 32px 12px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#35724e;text-transform:uppercase;letter-spacing:1px;">WATeamInbox / Cloud</td></tr>
          <tr><td style="padding:8px 32px 0;font-family:Georgia,serif;font-size:32px;line-height:1.1;color:#15211f;">One more click.</td></tr>
          <tr><td style="padding:18px 32px 0;font-size:16px;line-height:1.65;color:#42524d;">Confirm your email to join the WATeamInbox Cloud waitlist. This is for people who want updates about a future managed version of the project.</td></tr>
          <tr><td style="padding:28px 32px 16px;"><a href="${safeUrl}" style="display:inline-block;background:#1c633d;color:#ffffff;padding:14px 20px;text-decoration:none;font-weight:700;">Confirm my email address</a></td></tr>
          <tr><td style="padding:8px 32px 32px;font-size:13px;line-height:1.6;color:#64736e;">This link expires in three days. If you did not request it, you can safely ignore this email. WATeamInbox remains open source and self-hostable.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
