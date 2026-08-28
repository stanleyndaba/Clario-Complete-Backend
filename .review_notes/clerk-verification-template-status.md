# Clerk verification-email template validation status

- The Margin frontend uses Clerk-hosted verification code delivery through `signUp.verifications.sendEmailCode()` and `signIn.mfa.sendEmailCode()`.
- Clerk’s official documentation confirms hosted email templates are managed in Clerk Dashboard → Emails, with application branding/logo managed in Settings → Branding.
- The sandbox browser was not logged into Clerk.
- The authenticated My Browser connection was enabled and navigated to `https://dashboard.clerk.com/~/customization/email`; the page showed an authenticated Dashboard shell but did not render the email-template interface during two captured views. No Clerk template was changed.
- Exact runtime variables available for the selected verification email therefore remain unverified. The template must use only variables offered by Clerk’s editor for that exact template. Proposed request-location, time, IP, first-name, and expiry variables must be omitted unless the Clerk editor exposes them and the values are reliable.

The My Browser view loaded the **Margin / Production** Clerk instance. Its Email templates list includes the relevant **Verification code** template, described as “Send a verification code for authentication or account confirmation.” No template content has been edited yet.

The **Verification code** editor is open in the Margin **Production** instance. The current subject uses the supported code variable `{{otp_code}}`, establishing the actual verification-code variable to preserve. Clerk shows `notifications@margin-finance.com` as the current sender and an empty Reply-to local-part field. The editor is configured as Delivered by Clerk. No content or delivery settings have been changed.

The production editor’s source mode confirms that `{{otp_code}}` is the supported code variable and that the default template uses `{{app.name}}`. The source editor exposes the template body as an editable textarea. No verified first-name, expiry, IP, city, country, or time variable has been confirmed; those optional fields will be omitted rather than fabricated.

The editor now contains the approved production draft in source mode. It preserves `{{otp_code}}` as large, selectable text; updates the preheader and heading; includes the anti-phishing and ignore-if-unrequested guidance; removes sales CTAs; and adds the Margin footer with Privacy and Terms links. The greeting, expiry, and request-context sections were intentionally omitted because corresponding reliable Clerk variables were not confirmed. The subject field has not yet been changed or the template saved/published.

The production template subject is now set to **Your Margin sign-in code**. Clerk indicates unsaved changes; the draft has not yet been published.

The Reply-to local part has been set to `support`, making replies route to `support@margin-finance.com`. Clerk’s preview was opened before saving; it initially displayed a loading state and the preview chrome still showed its sample/default subject, so it cannot yet be treated as a successful rendering validation.

The pre-save preview rendered the existing saved email rather than the unsaved draft: it showed the old default subject and body with sample code `123456`. This validates that preview is useful only after saving in this Clerk view. The approved draft remains unsaved, and the Save control is visible.

Publishing is blocked by Clerk: after Save was selected, Clerk displayed an **Upgrade plan** modal stating that the Custom email templates feature is not available on the current plan for production instances. No upgrade was initiated and the verification-code template was not published. The production draft is still unsaved in the editor behind this modal.
