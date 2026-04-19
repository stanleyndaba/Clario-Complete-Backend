export interface ManualBroadcastEmailSource {
  subject?: string | null;
  heading?: string | null;
  summary?: string | null;
  body?: string | null;
  highlights?: string[] | null;
  cta_label?: string | null;
  cta_url?: string | null;
}

export interface ManualBroadcastEmailTemplate {
  subject: string;
  html: string;
  text: string;
  view: {
    email_subject: string;
    email_heading: string;
    email_summary: string | null;
    email_body: string;
    email_highlights: string[];
    action_label: string | null;
    action_url: string | null;
  };
}

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderParagraphsHtml(value: string): string {
  return clean(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => `<p style="margin:${index === 0 ? '0' : '18px'} 0 0 0; color:#262626; font-size:15px; line-height:1.8;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function normalizeHighlights(value?: string[] | null): string[] {
  return (value || [])
    .map((item) => clean(item))
    .filter(Boolean)
    .slice(0, 8);
}

export function buildManualUserBroadcastEmail(source: ManualBroadcastEmailSource): ManualBroadcastEmailTemplate {
  const subject = clean(source.subject) || 'A quick update from Margin';
  const heading = clean(source.heading) || subject;
  const body = clean(source.body);
  const summary = clean(source.summary) || null;
  const highlights = normalizeHighlights(source.highlights);
  const actionLabel = clean(source.cta_label) || null;
  const actionUrl = clean(source.cta_url) || null;
  const hasAction = Boolean(actionLabel && actionUrl);

  const htmlHighlights = highlights.length
    ? `
      <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
        <div style="font-size:14px; color:#111827; font-weight:600; line-height:1.7;">
          Key notes
        </div>
        <ul style="margin:12px 0 0 20px; padding:0; color:#333333; font-size:14px; line-height:1.8;">
          ${highlights.map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const htmlAction = hasAction
    ? `
      <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
        <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:600;">
          Next step
        </p>
        <p style="margin:10px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
          ${escapeHtml(actionLabel!)}:
          <a href="${escapeHtml(actionUrl!)}" style="color:#111827; text-decoration:underline; text-underline-offset:3px; word-break:break-all;">${escapeHtml(actionUrl!)}</a>
        </p>
      </div>
    `
    : '';

  const htmlSummary = summary
    ? `<p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">${escapeHtml(summary)}</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#ffffff; color:#171717; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
          ${escapeHtml(summary || heading)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Margin
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              ${escapeHtml(heading)}
            </h1>
            ${htmlSummary}
          </div>

          <div style="padding-top:24px;">
            ${renderParagraphsHtml(body)}
            ${htmlHighlights}
            ${htmlAction}

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Margin Team
            </p>
          </div>

          <p style="margin:28px 0 0 0; color:#737373; font-size:12px; line-height:1.7;">
            This is a direct account message from Margin. If anything feels unclear, reply to this email and we will help.
          </p>
        </div>
      </body>
    </html>
  `;

  const text = [
    heading,
    '='.repeat(Math.max(heading.length, 12)),
    '',
    summary ? `${summary}\n` : null,
    body,
    highlights.length ? `\nKey notes:\n${highlights.map((item) => `- ${item}`).join('\n')}` : null,
    hasAction ? `\n${actionLabel}: ${actionUrl}` : null,
    '',
    'Margin Team',
    '',
    'This is a direct account message from Margin. If anything feels unclear, reply to this email and we will help.'
  ].filter((part) => part !== null).join('\n');

  return {
    subject,
    html: html.trim(),
    text: text.trim(),
    view: {
      email_subject: subject,
      email_heading: heading,
      email_summary: summary,
      email_body: body,
      email_highlights: highlights,
      action_label: hasAction ? actionLabel : null,
      action_url: hasAction ? actionUrl : null
    }
  };
}
