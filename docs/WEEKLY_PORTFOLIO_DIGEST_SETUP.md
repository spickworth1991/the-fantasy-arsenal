# Weekly Portfolio Digest email setup

The in-app digest works without email configuration. Email delivery uses the Gmail API as
`contact.stickypicky@gmail.com`; it does not require an email marketing provider.

## 1. Configure Gmail

1. Open Google Cloud Console and create or select a project.
2. Enable **Gmail API**.
3. Configure the OAuth consent screen and add `contact.stickypicky@gmail.com` as a test user
   while the app remains in testing.
4. Create an **OAuth client ID** for a Web application.
5. Use OAuth Playground with your client ID/secret, authorize
   `https://www.googleapis.com/auth/gmail.send`, and exchange the authorization code.
6. Save the returned refresh token. Never commit it.

## 2. Add Cloudflare Pages secrets

In Cloudflare Dashboard:

**Workers & Pages → thefantasyarsenal.com project → Settings → Variables and Secrets**

Add these as encrypted secrets in Production and Preview:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `DIGEST_CRON_SECRET` — generate a long random value

The Gmail account that grants the refresh token must be
`contact.stickypicky@gmail.com`, because that is the From address used by the sender.

## 3. Schedule delivery

Create a cron-job.org job:

- URL: `https://thefantasyarsenal.com/api/arsenal/digest`
- Method: `GET`
- Schedule: Daily at 9:00 AM America/New_York
- Header: `Authorization: Bearer YOUR_DIGEST_CRON_SECRET`
- Timeout: at least 60 seconds

Run the cron every day. Each account chooses its Portfolio Digest delivery day and may enable a
separate NFL News Brief on another day. The endpoint checks the configured weekday and last
successful delivery, so only due editions are sent.

Users subscribe from **My Arsenal → Command Home → Weekly Portfolio Digest**. Their address and
enabled status are stored in the `arsenal_digest_subscriptions` D1 table. Disabling the toggle
keeps the address but stops delivery.

Test modes do not modify normal delivery timestamps:

- Portfolio Digest: `https://thefantasyarsenal.com/api/arsenal/digest?test=1`
- NFL News Brief: `https://thefantasyarsenal.com/api/arsenal/digest?test=news`
