# Tests

These tests run on your computer with Node 20 or newer. They use an in-memory fake of the Appwrite database and a fake Appwrite sign-in, so they need no internet and no real account. They do NOT prove that real Appwrite, Paddle, TikTok or the SMS app behave the same way.

```
cd appwrite/functions/api && npm install      # installs node-appwrite for the function
cd ../../../tests && npm install              # installs jsdom and jszip
npm test
```

- `function.test.mjs`: the server function (plans, quotas, payments, admin, SMS matching, Paddle webhook). Last result: 82 checks passed.
- `site.test.mjs`: the website in a fake browser talking to the real server code (sign-in, panels, currency, passwords, exports). Last result: 87 checks passed.
- `mockdb.mjs`: the fake database used by both.
