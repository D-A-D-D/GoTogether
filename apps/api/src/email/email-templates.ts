// The emails we send, as plain functions from data to text, so they can be tested
// without sending anything. Links carry the token in the URL *fragment* (after
// `#`): browsers never send a fragment to a server, so it stays out of access
// logs and out of the Referer header; the page reads it in the browser.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The page a link opens, with the token in the fragment. `origin` is the web app's address. */
export function tokenLink(origin: string, path: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${path}#token=${encodeURIComponent(token)}`;
}

function layout(heading: string, paragraphs: string[], link: string, buttonLabel: string): { text: string; html: string } {
  const text = [heading, '', ...paragraphs, '', link, '', '- GoTogether'].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1b1b1b">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#0f766e;color:#ffffff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">${escapeHtml(buttonLabel)}</a></p>
<p style="font-size:13px;color:#555;margin:0 0 4px">Or paste this address into your browser:</p>
<p style="font-size:13px;color:#555;word-break:break-all;margin:0">${escapeHtml(link)}</p>
</div>`;
  return { text, html };
}

export function passwordResetEmail(input: { to: string; name: string; link: string }): EmailMessage {
  const { text, html } = layout(
    'Reset your password',
    [
      `Hi ${input.name}, someone asked to reset the password for your GoTogether account.`,
      'This link works once and expires in 1 hour. If it was you, open it and choose a new password.',
      'If it was not you, ignore this email - your password has not been changed.',
    ],
    input.link,
    'Choose a new password',
  );
  return { to: input.to, subject: 'Reset your GoTogether password', text, html };
}

export function verificationEmail(input: { to: string; name: string; link: string }): EmailMessage {
  const { text, html } = layout(
    'Confirm your email address',
    [
      `Welcome to GoTogether, ${input.name}. Please confirm this is your email address.`,
      'This link works once and expires in 24 hours.',
      'If you did not create an account, ignore this email.',
    ],
    input.link,
    'Confirm my email',
  );
  return { to: input.to, subject: 'Confirm your GoTogether email address', text, html };
}
