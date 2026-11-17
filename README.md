# Chat Printer

Turn exported WhatsApp chats into a **PDF**, **PNG images** or **one self-contained HTML file** that keeps photos, voice notes and videos working. The chat is converted inside the visitor's browser and is never uploaded to a server.

> Not affiliated with WhatsApp or Meta Platforms, Inc.</br>
> Created by Zeeshan Ali

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
- Plans enforced on the server; manual billing through JazzCash and Easypaisa

## Plans

| Plan | Price | Media | Largest zip | Conversions |
|---|---|---|---|---|
| Free | PKR 0 | text only | 200 MB | 2 in total |
| Pro | PKR 450 / month | photos, voice notes, videos | 1 GB | 20 per day, renewed the next day |
| Ultra Pro | PKR 750 / month | photos, voice notes, videos | no limit | no limit |

The day counter follows Pakistan time (UTC+5).

## How it works

```
Browser (static site on Vercel)
   |  sign in                      |  plan checks, payments
   v                               v
Appwrite Auth              Appwrite Function (all rules live here)
                                   |
                                   v
                           Appwrite database: subscriptions, daily_usage, payments
```

Conversion itself happens locally in the browser. The server only decides whether a conversion is allowed, counts it, and records payments.

## Project structure

```
public/                      the website (static, no build step)
  index.html  app.js  config.js  style.css
  vendor/                    self-hosted libraries (JSZip, html2canvas, Appwrite Web SDK)
appwrite/functions/api/      server function (Node.js): quotas, payments, admin actions
docs/SETUP.md                step-by-step setup guide
vercel.json                  deployment settings and security headers
```

## Security notes

- `vercel.json` sets a strict Content-Security-Policy and other headers; no third-party scripts are loaded.
- Visitors have no direct database access. Every write goes through the function, and admin actions only work for the user ID in `ADMIN_USER_ID`.
- There are no secrets in this repository. Keep it that way: never commit API keys.
- Known limitation: because chats are converted in the browser, a technically skilled person can edit the page and skip the plan check. The server stops normal users, not determined ones.

## Third-party code

JSZip, html2canvas and the Appwrite Web SDK are bundled under `public/vendor/` and keep their own licenses.
