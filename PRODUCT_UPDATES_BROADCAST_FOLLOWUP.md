# Product Updates Broadcast Follow-Up

Date captured: 2026-04-19

This note captures the current state of the Product Updates publish + broadcast system so we can safely return to it later without re-debugging from scratch.

## Executive Status

The Product Updates foundation is in place and partially proven.

What is working:

- Product updates can be represented as durable canonical records.
- Published updates create durable broadcast jobs.
- The broadcast worker runs.
- Target resolution found at least one eligible user.
- In-app notification delivery succeeded for that user.
- Delivery truth is persisted in `product_update_broadcast_jobs` and `product_update_deliveries`.
- The system did not fake success. It correctly marked the broadcast job as failed when email delivery failed.

What is not yet proven:

- Product update email delivery is not working end-to-end yet.
- The exact email failure reason still needs to be inspected from delivery rows / notification delivery state.

## Relevant Implementation

Migration:

- `Integrations-backend/migrations/106_product_updates_publish_broadcast.sql`

Core backend paths:

- `Integrations-backend/src/services/productUpdateService.ts`
- `Integrations-backend/src/routes/productUpdateRoutes.ts`
- `Integrations-backend/src/notifications/services/notification_service.ts`
- `Integrations-backend/src/notifications/services/delivery/email_service.ts`
- `Integrations-backend/src/notifications/services/delivery/email_presenter.ts`

Frontend/admin paths:

- `opside-complete-frontend/src/pages/Admin.tsx`
- `opside-complete-frontend/src/pages/WhatsNew.tsx`
- `opside-complete-frontend/src/pages/NotificationHub.tsx`
- `opside-complete-frontend/src/lib/api.ts`

Recent commits involved:

- Backend: `201cc63 Improve product update create errors`
- Backend parent pointer: `57b8996 Update frontend product update admin pointer`
- Frontend: `d4b49c8 Show product update admin errors`

## Smoke Attempt Captured

Known product update broadcast job row from live smoke attempt:

```text
job id:              2649497f-ec2c-49bb-a09d-8a7368e6aaa9
product_update_id:   78f843bc-6e90-4f64-979a-a7c42ff8cee9
status:              failed
target_count:        1
in_app_sent_count:   1
email_sent_count:    0
skipped_count:       0
failed_count:        1
error:               1 delivery attempts failed
attempt_count:       1
started_at:          2026-04-19 15:10:04.041+00
completed_at:        2026-04-19 15:10:07.774+00
```

Interpretation:

- Publish succeeded.
- Broadcast job ran.
- One user was targeted.
- In-app notification succeeded.
- Email delivery failed.
- This is not a WhatsNew/source-of-truth failure.
- This is not an admin-permission failure.
- This is now an Agent 10 email delivery/config/resolution follow-up.

## Targeting Truth

Product update broadcasts do not target users because they are admins.

The target resolver currently selects users through active tenant memberships:

- `tenant_memberships.is_active = true`
- `tenant_memberships.deleted_at is null`
- tenant status is `active` or `trialing`
- tenant is not deleted
- each user is targeted once even if they have multiple workspace memberships

So an admin row in `users` is not enough by itself. The user also needs an active tenant membership.

## Preference Truth

Product Updates has its own notification type:

```text
product_update
```

Default preference:

```text
email: true
inApp: true
```

Email can still be suppressed if the user's stored notification preferences disable Product Updates email.

## Why The SQL Join Failed During Debugging

The attempted diagnostic joins failed because `users.id` is UUID while these columns are text:

- `product_update_deliveries.user_id`
- `notifications.user_id`

Use explicit casts when joining:

```sql
join users u on u.id::text = pud.user_id
```

and:

```sql
join users u on u.id::text = n.user_id
```

## Correct Follow-Up SQL

Use this to inspect delivery rows for the captured product update:

```sql
select
  u.email,
  pud.channel,
  pud.status,
  pud.error,
  pud.sent_at,
  pud.notification_id
from product_update_deliveries pud
join users u on u.id::text = pud.user_id
where pud.product_update_id = '78f843bc-6e90-4f64-979a-a7c42ff8cee9'
order by u.email, pud.channel;
```

Use this to inspect the related notification delivery state:

```sql
select
  n.id,
  u.email,
  n.type,
  n.channel,
  n.status,
  n.delivery_state,
  n.last_delivery_error,
  n.created_at,
  n.delivered_at
from notifications n
join users u on u.id::text = n.user_id
where n.id in (
  select notification_id
  from product_update_deliveries
  where product_update_id = '78f843bc-6e90-4f64-979a-a7c42ff8cee9'
    and notification_id is not null
);
```

Use this to check whether `mvelo@margin-finance.com` is eligible as a broadcast target:

```sql
select
  u.id,
  u.email,
  u.role,
  u.status as user_status,
  tm.tenant_id,
  tm.is_active as membership_active,
  tm.deleted_at as membership_deleted_at,
  t.status as tenant_status,
  t.deleted_at as tenant_deleted_at
from users u
left join tenant_memberships tm on tm.user_id::text = u.id::text
left join tenants t on t.id = tm.tenant_id
where u.email = 'mvelo@margin-finance.com';
```

Use this to inspect recent product update jobs:

```sql
select
  puj.id,
  puj.product_update_id,
  pu.title,
  pu.status as product_update_status,
  pu.published_at,
  pu.broadcasted_at,
  puj.status as job_status,
  puj.target_count,
  puj.in_app_sent_count,
  puj.email_sent_count,
  puj.skipped_count,
  puj.failed_count,
  puj.error,
  puj.attempt_count,
  puj.started_at,
  puj.completed_at
from product_update_broadcast_jobs puj
join product_updates pu on pu.id = puj.product_update_id
order by puj.created_at desc
limit 20;
```

## Likely Email Failure Causes To Check Later

Once the corrected SQL exposes `pud.error` or `notifications.last_delivery_error`, check for these likely causes:

- Missing `EMAIL_API_KEY`
- Missing provider-specific key such as `SENDGRID_API_KEY` or `RESEND_API_KEY`
- Wrong `EMAIL_PROVIDER`
- Unverified `EMAIL_FROM_EMAIL` / sending domain
- Email provider rejection
- `No email found for user`
- `EMAIL_RESOLUTION_FAILED`
- Product Updates email preference disabled

Do not guess the fix before reading the persisted error.

## Safe Resume Plan

1. Run the corrected SQL queries above.
2. Identify the exact email failure from:
   - `product_update_deliveries.error`
   - `notifications.last_delivery_error`
   - `notifications.delivery_state`
3. If the failure is provider config, fix Render email environment variables or sender domain verification.
4. If the failure is email resolution, patch `EmailService.getUserEmail(...)` or the target resolver.
5. If the failure is preferences, confirm the intended user has Product Updates email enabled.
6. Retry only the failed email path if possible.

Important safety note:

- In-app delivery already succeeded for the captured update.
- Retry behavior should not duplicate the in-app notification.
- `product_update_deliveries` has a unique constraint on `(product_update_id, user_id, channel)`.
- The worker checks already sent/skipped channels before retrying.

## Current Recommendation

Do not spend more product time here until email delivery itself matters again.

The system now has a real product update model, admin publish surface, WhatsNew read surface, and durable delivery audit trail. The remaining issue is narrower: product update email delivery failed for the one targeted user and needs one focused Agent 10 email-delivery follow-up.
