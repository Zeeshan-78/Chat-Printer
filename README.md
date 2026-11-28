# Chat Printer

Turn exported WhatsApp chats into a **PDF**, **PNG images** or **one self-contained HTML file** that keeps photos, voice notes and videos working. The chat is converted inside the visitor's browser and is never uploaded to a server.

> Not affiliated with WhatsApp or Meta Platforms, Inc.

## Features

- Upload a `.zip` (exported with media) or a `.txt` file; Android and iPhone formats
- WhatsApp-style preview with light and dark themes; choose which person is "me"
- Output as PDF (print dialog), PNG images, or a standalone HTML file with media embedded
- Photos, stickers, voice notes, videos and documents
- WhatsApp text formatting (bold, italic, strikethrough, monospace), clickable links, large emoji, "edited" labels
- Deleted-message markers for both people, and restoring their text from an older export
- Search and filter, chat info box, hide system messages and "Media omitted"
- Date range filter: export only the messages between two dates
- Accounts: email and password (new accounts confirm the email with a code), Google, Facebook and GitHub; profile with photo and phone number
- User panel (profile, password, plan and usage, payments) and an admin panel (stats, payments, users, database)
- Prices shown in the visitor's currency (detected from location, changeable)
- Automatic payment checks (wallet SMS matching and card checkout with webhooks), with manual approval still available
- Password eye toggle and strength meter, sessions and data download, receipts
- SEO: guides, sitemap, structured data
- Browser extension (Chat Printer Exporter) for Messenger, Instagram, X, Telegram Web, LinkedIn and Discord, with the same WhatsApp-style look, downloadable from /extension
- Plans enforced on the server; manual billing through JazzCash and Easypaisa

## Plans

| Plan | Price | Media | Largest zip | Messages |
|---|---|---|---|---|
| Free | PKR 0 (1 export, sign-up required) | text only | 200 MB | first 100 only |
| Full export | pay once per export — PKR 100 (international: USD/EUR 1.49, GBP 1.29, SAR/AED 5.49, CNY 10.9, INR 129) | photos, voice notes, videos | 1 GB | complete chat |

Every approved payment adds one export credit to the account; each export consumes one credit.

## How it works

```
Browser (static site on Vercel)
   |  sign in                      |  plan checks, payments
   v                               v
Appwrite Auth              Appwrite Function (all rules live here)
                                   |
                                   v
                           Appwrite database: subscriptions, payments, extension keys
```

Conversion itself happens locally in the browser. The server only decides whether a conversion is allowed, counts it, and records payments.

## Project structure

```
extension/chat-printer-exporter/  the browser extension for other chat apps (see docs/EXTENSION.md)
public/                      the website (static, no build step)
  index.html  app.js  config.js  style.css
  vendor/                    self-hosted libraries (JSZip, html2canvas, Appwrite Web SDK)
appwrite/functions/api/      server function (Node.js): quotas, payments, admin actions
docs/SETUP.md                step-by-step setup guide
docs/PAYMENTS.md             which payment tools to use and why
docs/HANDOFF.md              full project handoff: status, architecture, runbook, open items
tools/set-domain.py          change the website address in SEO files
tools/build-extension.py     pack the extension into public/downloads and update its download box
vercel.json                  deployment settings and security headers
```

## Getting started

Follow [docs/SETUP.md](docs/SETUP.md). In short: create an Appwrite project, deploy the function, put your IDs in `public/config.js`, deploy the repository on Vercel, then press "Run database setup" in the admin box.

To look at the site locally: `npx serve public`.

## Security notes

- `vercel.json` sets a strict Content-Security-Policy and other headers (HSTS, nosniff, frame denial, COOP, Permissions-Policy); no third-party scripts are loaded.
- Visitors have no direct database access. Every write goes through the function, and admin actions only work for the user ID in `ADMIN_USER_ID`.
- The function rate-limits calls (30 per minute per user and action), caps request bodies, and the browser extension is useless without a signed-in user's extension key (`ext_auth`).
- There are no secrets in this repository. Keep it that way: never commit API keys.
- Known limitation: because chats are converted in the browser, a technically skilled person can edit the page and skip the plan check. The server stops normal users, not determined ones.

## Third-party code

JSZip, html2canvas and the Appwrite Web SDK are bundled under `public/vendor/` and keep their own licenses.

## License

Add a license before making the repository public (for example MIT). Until then, all rights are reserved.
