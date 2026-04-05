# Margin Hard E2E Launch Checklist

## North Star

This checklist is for one purpose:

- prove the full product loop end to end
- catch truth-breaking bugs before wider rollout
- onboard only `5` live users first
- hold the remaining `95` for `24 hours`
- patch bugs, harden infra, and widen access only after the loop is trustworthy

This is not a hype checklist.
This is a truth checklist.

## Launch Truth

We are not proving "market domination" yet.
We are proving:

- users can log in
- users can connect Amazon
- data syncs correctly
- discrepancies appear truthfully
- evidence is visible
- cases move through filing or appeal correctly
- emails and notifications match real state
- the dashboard tells the same story as the detailed pages
- session recovery does not break trust

If this passes with `5` real users, we earn the right to test broader demand.

## Pilot Policy

- [ ] Onboard only `5` live users
- [ ] Keep the remaining `95` on hold for `24 hours`
- [ ] Do not widen access until all critical phases below are reviewed
- [ ] Track every bug found during the `5`-user window
- [ ] Patch severe issues before moving beyond the pilot

## Severity Rules

- `P0`
  - login broken
  - OAuth broken
  - session loop / session panel spam
  - wrong tenant access
  - duplicate filing risk
  - false filing-ready state
  - data corruption or broken payout truth
- `P1`
  - wrong status shown
  - dashboard and detail pages disagree
  - broken deep link
  - missing evidence truth
  - key notification/email mismatch
- `P2`
  - non-blocking UX confusion
  - layout friction
  - text polish

## Evidence We Capture For Every Phase

- [ ] pass / fail
- [ ] date and tester
- [ ] screen recording or screenshots
- [ ] exact route tested
- [ ] bug link or note if failed
- [ ] decision:
  - `pass`
  - `pass with patch`
  - `block launch`

---

## Phase 1: Access And Identity

### Goal

User can land, sign in, and reach the right workspace without friction.

### Checklist

- [ ] Landing page loads correctly
- [ ] Login page loads correctly
- [ ] User can sign in successfully
- [ ] User returns to the intended page after sign-in
- [ ] Correct tenant workspace loads
- [ ] No auth redirect loops
- [ ] No stuck loading state after login
- [ ] Session state is stable on refresh

### Pass Only If

- [ ] No `P0` auth issue exists
- [ ] No tenant mismatch exists
- [ ] No broken redirect exists

---

## Phase 2: Session Recovery

### Goal

Expired sessions recover calmly and do not harass the user.

### Checklist

- [ ] Silent refresh is attempted first
- [ ] Session panel appears only when refresh fails
- [ ] `Dismiss` does not reopen again for the same expired session
- [ ] `Refresh session` works when recoverable
- [ ] `Sign in again` returns user to the same place
- [ ] Protected background loaders stop hammering the app while session is invalid
- [ ] No raw `401` appears in user-facing UI

### Pass Only If

- [ ] No repeat pop-back behavior remains
- [ ] No auth/session UI loop remains
- [ ] No shell-level request spam remains

---

## Phase 3: Tenant And Workspace Bootstrap

### Goal

Tenant context loads truthfully and only when it should.

### Checklist

- [ ] Workspace route resolves correctly
- [ ] Tenant slug is correct
- [ ] Tenant switch works
- [ ] Sidebar and navbar reflect the correct tenant
- [ ] Non-app routes do not trigger protected tenant loading
- [ ] No cross-tenant leakage appears

### Pass Only If

- [ ] Workspace identity is always correct
- [ ] No wrong workspace state appears after login or refresh

---

## Phase 4: Amazon Connection

### Goal

User can connect Amazon and return safely into the product.

### Checklist

- [ ] Integrations page loads
- [ ] Amazon connect flow starts correctly
- [ ] OAuth callback returns to correct tenant
- [ ] Amazon connected state is visible
- [ ] Broken connection states are clear and recoverable
- [ ] No false "connected" state appears

### Pass Only If

- [ ] OAuth succeeds or fails clearly
- [ ] No callback routing break exists

---

## Phase 5: Sync And Data Arrival

### Goal

Initial sync completes and data begins showing up in the platform correctly.

### Checklist

- [ ] Sync starts from the intended surface
- [ ] Sync progress is visible
- [ ] Sync completes without manual intervention
- [ ] Dashboard updates after sync
- [ ] Recoveries / detections surfaces update after sync
- [ ] Empty-state behavior is correct when no data is ready

### Pass Only If

- [ ] No ghost loading
- [ ] No stale post-sync dashboard
- [ ] No broken progress or completion state

---

## Phase 6: Detection Truth

### Goal

The platform surfaces discrepancies accurately and understandably.

### Checklist

- [ ] `Issues Found` loads
- [ ] Findings count is correct
- [ ] Case identifiers and values are consistent
- [ ] Search and filters work
- [ ] Findings state is clear:
  - [ ] found
  - [ ] needs review
  - [ ] ready
  - [ ] moved into case
- [ ] No obvious duplicate findings
- [ ] No obviously false finding appears

### Pass Only If

- [ ] The queue tells the truth
- [ ] Summary counts reconcile with the rows

---

## Phase 7: Evidence And Documents

### Goal

The user can see what proof exists, what is missing, and what needs to be rebuilt.

### Checklist

- [ ] `Documents` page loads
- [ ] Evidence-linked counts are believable
- [ ] Missing requirements are visible
- [ ] Evidence state changes after documents arrive
- [ ] No false "ready" state appears without proof
- [ ] Detail surfaces explain missing proof clearly

### Pass Only If

- [ ] Evidence truth is visible and consistent
- [ ] No silent missing-proof state remains

---

## Phase 8: Filing Flow

### Goal

Supported cases move into filing correctly and unsupported ones stay blocked.

### Checklist

- [ ] Dispute Cases page loads
- [ ] Filing queue reflects real case readiness
- [ ] Ready cases can move forward
- [ ] Weak or unsupported cases are held
- [ ] No duplicate filing path exists
- [ ] Case state updates after filing

### Pass Only If

- [ ] No weak claim can slip through
- [ ] No duplicate claim risk exists
- [ ] Filing state is truthful

---

## Phase 9: Recoveries And Dashboard Truth

### Goal

Dashboard summaries and operational pages tell one consistent story.

### Checklist

- [ ] Overview rail matches actual underlying case state
- [ ] `Issues Found` matches real findings
- [ ] `Evidence` tab reflects actual proof status
- [ ] Recoveries page matches dashboard summary
- [ ] Counts reconcile across dashboard, recoveries, and cases
- [ ] Deep links from dashboard go to the correct destination
- [ ] "Updated" timestamps are believable

### Pass Only If

- [ ] Dashboard never contradicts detail pages
- [ ] Summary metrics are trustworthy

---

## Phase 10: Appeals / Reopen Claims

### Goal

Denied and underpaid cases are understandable, actionable, and rebuildable.

### Checklist

- [ ] `Reopen Claims` page loads
- [ ] Reopen queue rows are summary-first and understandable
- [ ] No raw Amazon essay appears in the row itself
- [ ] Drawer opens correctly
- [ ] Drawer shows:
  - [ ] Amazon pushback
  - [ ] missing proof
  - [ ] reopen state
  - [ ] rebuild plan
  - [ ] next move
- [ ] Links from drawer work

### Pass Only If

- [ ] Reopen queue feels like triage, not archive
- [ ] Rebuild direction matches the actual denial reason

---

## Phase 11: Notifications And Email Lifecycle

### Goal

Product communication stays true across in-app and email states.

### Checklist

- [ ] In-app notifications arrive correctly
- [ ] Email: needs evidence
- [ ] Email: closed pending response
- [ ] Email: approved
- [ ] Email: rejected
- [ ] Email: paid
- [ ] Email links deep-link to correct tenant and case
- [ ] No duplicate sends
- [ ] No contradiction between case state and communication

### Pass Only If

- [ ] Every communication is state-true
- [ ] No misleading lifecycle email remains

---

## Phase 12: Failure States And Safety

### Goal

Failures degrade cleanly and do not destroy trust.

### Checklist

- [ ] Empty states are clear
- [ ] API failures degrade cleanly
- [ ] Unauthorized state is recovered gracefully
- [ ] No raw backend language leaks into user UI
- [ ] Broken integrations show clear next steps
- [ ] Long-running tasks do not trap the user

### Pass Only If

- [ ] No dead-end failure state exists
- [ ] No machine-language error leaks in primary UI

---

## Phase 13: Cross-Device Review

### Goal

The platform holds up beyond a single display and render environment.

### Checklist

- [ ] Test on primary laptop
- [ ] Test on second laptop
- [ ] Review color contrast on both
- [ ] Review spacing rhythm on both
- [ ] Check one mobile session/auth flow

### Pass Only If

- [ ] UI decisions hold across devices
- [ ] No screen-specific false judgment is driving launch decisions

---

## 5-User Pilot Execution

### User Set

- [ ] User 1 onboarded
- [ ] User 2 onboarded
- [ ] User 3 onboarded
- [ ] User 4 onboarded
- [ ] User 5 onboarded

### For Each User

- [ ] Login completed
- [ ] Tenant loaded
- [ ] Amazon connected
- [ ] Sync started
- [ ] Sync completed
- [ ] Findings surfaced
- [ ] Evidence state reviewed
- [ ] Filing or reopen path reviewed
- [ ] Notifications checked
- [ ] Email lifecycle checked if triggered
- [ ] No `P0`
- [ ] No unresolved `P1`

---

## 24-Hour Hold On The Other 95

During the hold window:

- [ ] Freeze wider onboarding
- [ ] Patch every `P0` immediately
- [ ] Patch `P1` items affecting the main loop
- [ ] Re-run affected E2E phases after each patch
- [ ] Check logs for auth, sync, email, and API instability
- [ ] Confirm infra stability under the pilot load

---

## Go / No-Go Gate

### Go Only If

- [ ] All critical phases above are reviewed
- [ ] No `P0` remains
- [ ] No unresolved `P1` blocks the 5-user path
- [ ] Session recovery is stable
- [ ] Dashboard and detail truth reconcile
- [ ] Filing and reopen paths are trustworthy
- [ ] Emails and notifications are truthful
- [ ] The 5-user pilot completes the loop without critical failure

### No-Go If

- [ ] auth is unstable
- [ ] tenant routing is unstable
- [ ] sync is unstable
- [ ] filing truth is uncertain
- [ ] appeal truth is uncertain
- [ ] emails are untrustworthy
- [ ] dashboard contradicts actual case state

---

## Final Launch Proof We Need Before Wider Rollout

- [ ] 5 users successfully complete the loop
- [ ] real recoveries begin to appear
- [ ] no critical session/auth regressions
- [ ] no duplicate-claim or false-ready risk
- [ ] core trust surfaces hold under real use

If this checklist is not honestly checked off, we do not widen the rollout.

If it is checked off, we move from "platform readiness" into real user proof.
