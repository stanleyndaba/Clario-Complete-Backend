# Margin verification-code email — Clerk-safe implementation specification

**Purpose.** This is the approved Margin copy adapted for Clerk’s hosted authentication-email editor. It must be applied only to the **email verification code / sign-in code** template used by the active Margin Clerk instance. The frontend dispatches this email through Clerk, not through the Margin backend.

## What can be applied exactly

| Template element | Approved value |
| --- | --- |
| Subject | **Your Margin sign-in code** |
| Preheader | **Use this code to finish signing in. Do not share it with anyone.** |
| Heading | **Finish signing in to Margin** |
| Main copy | Use the approved account, code, anti-phishing, ignore-if-unrequested, and subdued footer copy below. |
| CTA | **None.** The code block is the action. |
| Logo/brand | Use Clerk application branding. Confirm that Margin’s logo has been uploaded in Clerk **Settings → Branding** and that the application name is **Margin**. Insert `{{> app_logo}}` where it is available. |

## Variable safety rules

The public Clerk documentation confirms the template editor offers a variable picker, but it does not publish a universal verification-code variable list. The exact available variables must therefore be verified **inside the selected template** before save.

> Do not type or retain an unverified Handlebars variable. Use the template’s existing code block and its variable picker, because that preserves the cryptographically correct verification code from Clerk.

The following decisions follow the supplied requirements.

| Requested field | Implementation decision |
| --- | --- |
| Verification code | Retain the template’s existing Clerk-provided verification-code variable/block. Style it as a large, high-contrast, selectable text block. Do not use an image. |
| Expiry | Keep an expiry sentence only if this exact Clerk template exposes a real expiry variable or currently renders an enforced expiry. Otherwise, omit the sentence. |
| First name | Include `Hi …,` only if the template variable picker exposes a verified recipient first-name value. Otherwise, omit the greeting entirely. Do not derive a name from an email address. |
| Request city, country, UTC time, and IP | Omit unless the selected template explicitly provides each value. Clerk template variables should not be guessed, and location must never be fabricated. |
| Privacy and Terms | Use the actual Margin public URLs: `https://app.margin-finance.com/privacy` and `https://app.margin-finance.com/terms`. |

## Ready-to-apply content

The bracketed items below are editorial placement markers, **not** variable names. Replace them only using values available from Clerk’s editor. Keep the existing default verification-code block when converting the template.

### Body

```text
[Margin logo / app-brand block]

Finish signing in to Margin

[Optional: Hi {verified first name},]

You are one step away from your Margin account. Enter this code when prompted:

[Keep Clerk’s existing verification-code block here]

[Optional: This code expires in {Clerk-provided enforced expiry} minutes.]

For your security, only enter this code on Margin. Margin will never ask you to share it by email, phone call, text message, or support chat.

Didn’t request this?

You do not need to do anything. You can safely ignore this email—your account cannot be accessed without this code.

[Optional: Request details only when each Clerk-provided request-context value is present and reliable.]

If something still does not look right, reply to this email or contact support@margin-finance.com.

Margin
Clear recovery work. You stay in control.

Questions about your account or Audit? Reply to this email or contact support@margin-finance.com.

© 2026 Margin. All rights reserved.
Privacy · Terms
```

## Layout requirements

Use a calm, white background with a narrow, mobile-safe content column. Display the code as large dark text on a light neutral panel with a border. It must be plain, selectable text—not a button, image, QR code, or linked call-to-action. Keep the anti-phishing guidance immediately below the code/expiry content and set the footer in smaller, visually subdued text.

The underlying email engine may transpile the editor content to table-based HTML. Use Clerk’s preview in desktop and mobile modes before publishing. Do not customize the content such that the existing code is missing, unreadable, or moved into an image.

## Publication checklist

1. In Clerk Dashboard, open **Emails**, select the verification-code/sign-in-code template, and confirm it is the template invoked by Margin’s email-code sign-up and sign-in flows.
2. Confirm the correct Clerk instance and environment (development/staging/production) before editing.
3. Use the editor’s variable picker to retain the existing code token and identify whether verified first-name, expiry, and request-context fields exist.
4. Apply the approved subject, preheader, brand block, body copy, code styling, and footer.
5. Preview desktop and mobile layouts, then send a non-production test email if the selected instance permits it.
6. Publish only after the code, expiry claim, and every displayed request-detail value are visibly verified.

## Evidence boundary

This specification is ready for configuration, but it is **not evidence that the edited Clerk template has been published or that real delivery has been verified**. Those require an authenticated Clerk dashboard review and an explicit save/publish action.

## Reference

[1]: https://clerk.com/docs/guides/customizing-clerk/email-sms-templates "Clerk — Email and SMS templates"
