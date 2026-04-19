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
    .map((paragraph) => `<p style="margin:14px 0 0 0; color:#2f2f2f; font-size:15px; line-height:1.75;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
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
      <div style="margin-top:22px; padding:18px; background:#f7f7f5; border-radius:14px; border-left:4px solid #111827;">
        <div style="font-size:12px; color:#525252; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
          Key notes
        </div>
        <ul style="margin:12px 0 0 18px; padding:0; color:#262626; font-size:14px; line-height:1.7;">
          ${highlights.map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const htmlAction = hasAction
    ? `
      <div style="margin-top:26px;">
        <a href="${escapeHtml(actionUrl!)}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:10px; font-weight:700; font-size:14px;">
          ${escapeHtml(actionLabel!)}
        </a>
      </div>
      <p style="margin:16px 0 0 0; color:#737373; font-size:12px; line-height:1.5;">
        If the button does not work, copy and paste this link:<br>
        <a href="${escapeHtml(actionUrl!)}" style="color:#111827; word-break:break-all;">${escapeHtml(actionUrl!)}</a>
      </p>
    `
    : '';

  const htmlSummary = summary
    ? `<p style="margin:16px 0 0 0; color:#d4d4d4; font-size:15px; line-height:1.7;">${escapeHtml(summary)}</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#f5f5f3; color:#171717; font-family:Arial, sans-serif;">
        <div style="max-width:620px; margin:0 auto; padding:28px 18px;">
          <div style="background:#0b0b0b; color:#ffffff; border-radius:18px; padding:28px;">
            <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#a3a3a3; font-weight:700;">
              From Margin
            </div>
            <h1 style="margin:12px 0 0 0; font-size:30px; line-height:1.08; font-weight:700;">
              ${escapeHtml(heading)}
            </h1>
            ${htmlSummary}
          </div>

          <div style="background:#ffffff; border-radius:18px; padding:24px; margin-top:14px; border:1px solid #e7e5e4;">
            ${renderParagraphsHtml(body)}
            ${htmlHighlights}
            ${htmlAction}

            <div style="margin-top:24px; padding-top:18px; border-top:1px solid #e7e5e4;">
              <p style="margin:0; color:#525252; font-size:14px; line-height:1.6;">
                Margin
              </p>
            </div>
          </div>

          <p style="margin:18px 0 0 0; text-align:center; color:#737373; font-size:12px;">
            This is a direct account message from Margin.
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
    'Margin',
    '',
    'This is a direct account message from Margin.'
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
