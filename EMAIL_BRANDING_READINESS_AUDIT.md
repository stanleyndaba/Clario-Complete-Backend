# Email Branding Readiness Audit

Date: April 4, 2026
Domain: `margin-finance.com`
Scope: inbox avatar / sender logo readiness for Agent 10 emails

## Executive verdict

Status: `Partially ready`

Email delivery and sender authentication are in a good place, but branded inbox logos are **not ready yet**.

What is already working:
- emails are sending successfully via Resend
- emails are arriving quickly
- emails are not landing in spam in current live checks
- SPF exists
- DMARC exists
- DKIM exists for the Resend selector

What is missing:
- no BIMI TXT record
- no BIMI certificate URL
- no confirmed BIMI-ready hosted SVG logo
- no confirmed Apple Branded Mail setup

## Live DNS findings

### SPF

Current TXT record on `margin-finance.com`:

```txt
v=spf1 include:dc-aa8e722993._spfm.margin-finance.com ~all
```

Assessment:
- present
- good baseline for sender authentication

### DMARC

Current TXT record on `_dmarc.margin-finance.com`:

```txt
v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;
```

Assessment:
- present
- `p=quarantine` is good
- `pct=100` is **not explicitly published**

Note:
- DMARC spec defaults `pct` to `100`, but official BIMI guidance from Google and Resend expects `pct=100` to be published explicitly
- for readiness purposes, treat this as a follow-up item

### DKIM

Found DKIM at:

```txt
resend._domainkey.margin-finance.com
```

Assessment:
- present
- this is a strong sign that the sending domain is properly authenticated for Resend

### BIMI

Lookup result:

```txt
default._bimi.margin-finance.com
```

Assessment:
- does **not** exist
- this is the main blocker for branded sender logos in supporting inboxes

### MX

Current MX points to Google Workspace:

- `aspmx.l.google.com`
- `alt1.aspmx.l.google.com`
- `alt2.aspmx.l.google.com`
- `alt3.aspmx.l.google.com`
- `alt4.aspmx.l.google.com`

Assessment:
- good
- relevant because Gmail/Google Workspace branding expectations matter here

## Provider readiness

### Gmail

Current state:
- not ready for branded inbox logo yet

Why:
- no BIMI record
- no certificate path
- no confirmed hosted BIMI SVG

Likely path:
- BIMI
- CMC or VMC
- explicit DMARC `pct=100`

### Apple Mail

Current state:
- not ready yet

Likely path:
- Apple Branded Mail
or
- BIMI plus the required certificate path depending target clients

### Outlook

Current state:
- do not count on branded inbox avatar support

Note:
- Resend’s BIMI documentation shows Outlook as not currently supporting BIMI logos

## What must be done next

### 1. Update DMARC explicitly

Recommended next record:

```txt
v=DMARC1; p=quarantine; pct=100; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;
```

Optional future hardening:
- evaluate `p=reject`
- evaluate stricter alignment if needed later

### 2. Prepare logo assets

For BIMI:
- square logo
- SVG Tiny P/S compliant
- no scripts
- no external references

For Apple Branded Mail:
- 1024x1024 logo asset
- PNG, JPEG, or HEIF as required by Apple Business Connect

### 3. Choose path

Fastest useful path:
- Apple Branded Mail for Apple ecosystem visibility

Strongest broad brand path:
- BIMI + CMC/VMC

### 4. Publish BIMI record

Target host:

```txt
default._bimi.margin-finance.com
```

Expected shape:

```txt
v=BIMI1; l=https://margin-finance.com/.well-known/bimi/margin-logo.svg; a=https://margin-finance.com/.well-known/bimi/margin-logo.pem;
```

Notes:
- `l=` is the logo URL
- `a=` is the certificate URL
- exact final URLs depend on where the assets are hosted

### 5. Verify business / trademark path

For Gmail-facing brand display, expect one of:
- CMC
- VMC

This may require:
- trademark readiness
- proof of logo ownership/use

## Candidate logo assets already in repo

These are the most likely starting points:

- [favicon-margin.svg](/c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/public/favicon-margin.svg)
- [logo-abstract.svg](/c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/public/logo-abstract.svg)
- [logoimagetwo.png](/c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/public/logoimagetwo.png)

Current status:
- not yet audited for BIMI compliance
- not yet checked for square-safe small-size rendering
- not yet prepared for Apple Branded Mail upload

## Recommended next session

When we come back to this, do the work in this order:

1. pick the final logo mark
2. create BIMI-safe SVG asset
3. create Apple-ready 1024x1024 asset
4. update DMARC to include `pct=100`
5. publish BIMI DNS record
6. decide whether to pursue CMC or VMC
7. optionally set up Apple Branded Mail
8. send live proof emails again and check inbox logo rendering

## Sources

- Resend BIMI docs:
  - https://resend.com/docs/dashboard/domains/bimi
- Google Workspace BIMI docs:
  - https://support.google.com/a/answer/10911320
- Resend Apple Branded Mail docs:
  - https://resend.com/docs/knowledge-base/how-do-i-set-up-apple-branded-mail
- BIMI Group sender FAQ:
  - https://bimigroup.org/faqs-for-senders-esps/

## Final takeaway

The email system is operationally healthy.

The sender-branding layer is **not blocked by deliverability**.

It is now blocked by:
- BIMI setup
- certificate / brand verification path
- final logo asset preparation
