# Gmail Read Tracker (Safari)

A lightweight Mailsuite alternative: see when people open emails you send from Gmail in Safari.

- **`worker/`**: a Cloudflare Worker (free tier) that serves an invisible 1×1 image per email, records when it loads, and hosts a dashboard.
- **`userscript/`**: a script run by the free [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) Safari extension. It adds the image when you click Send, hides it when you view your own sent mail, and shows read status inside Gmail.

Only **you** need this setup. Recipients can use any mail app.

## Setup

### 1. Deploy the worker
```sh
cd worker
npm install
npx wrangler login                  # opens browser; free Cloudflare account
npx wrangler d1 create mailtrack    # copy the printed database_id into wrangler.toml
npm run db:init                     # create tables
openssl rand -hex 24                # generate an API key, then:
npx wrangler secret put API_KEY     # paste the key
npm run deploy                      # prints https://mailtrack.<you>.workers.dev
```
Open the printed URL and enter your API key to see the dashboard.

### 2. Install the userscript
1. Install **Userscripts** from the Mac App Store and open it once. Choose a folder for scripts.
2. In Safari → Settings → Extensions, enable **Userscripts**. Allow it on `mail.google.com` (choose "Always Allow on This Website").
3. Copy `userscript/gmail-read-tracker.user.js` into the Userscripts folder. Edit the two constants at the top:
   ```js
   const WORKER_URL = "https://mailtrack.<you>.workers.dev";
   const API_KEY = "<the key from step 1>";
   ```
4. Reload Gmail.

## Using it
- In every compose window, a **👁 Tracking** chip appears next to Send. It's on by default; click it to turn tracking off for that email.
- A **👁 Tracked** button in the bottom-left of Gmail lists your recent tracked emails:
  - **✓ Sent** means not opened yet.
  - **✓✓ Opened** shows when it was opened and how many times.
- The first time you open that panel, Safari asks for notification permission. If you allow it, you get a notification when someone opens an email while Gmail is open.
- For the full history, open the dashboard at your worker URL.

## Turning it off
From lightest to complete:

1. **One email:** click the **👁 Tracking** chip next to Send so it reads **👁 Off**. That email is sent without the pixel.
2. **Just this script:** click the Userscripts toolbar icon in Safari, or open the Userscripts app, and switch off "Gmail Read Tracker". Then reload Gmail.
3. **The whole Userscripts extension:** in Safari → Settings → Extensions, uncheck **Userscripts**. This also stops any other scripts it runs.
4. **Remove everything, including the server** (permanent):
   ```sh
   cd worker
   npx wrangler delete                  # removes the Worker and its URL
   npx wrangler d1 delete mailtrack     # deletes the database and all open history
   ```
   Then delete the script from your Userscripts folder, and uninstall the app if you like.

With options 1–3, the Worker keeps running. Emails you already sent still contain the pixel, so opens of those keep being recorded until you delete the Worker. After that, those images just fail to load for the recipient, which is invisible and harmless.

## Local development
```sh
cd worker
cp .dev.vars.example .dev.vars   # API_KEY=dev-key
npm run db:init:local
npm run dev                      # http://localhost:8787
```

## Limitations
- **Images blocked:** if the recipient's mail app blocks images, their open is never recorded.
- **Apple Mail Privacy Protection:** Apple Mail can load images in advance, so an email may show as opened soon after delivery even if nobody read it.
- **Your own views elsewhere:** your views are filtered out only in Safari with the script. Opening your sent mail in the Gmail phone app or in another browser counts as an open.
- **Repeat opens:** Gmail's image proxy sometimes caches the image, so repeat-open counts are approximate. The first open is reliable.
- **Send paths:** tracking hooks into the Send button and ⌘/Ctrl+Enter. Scheduled send ("Schedule send" menu) isn't tracked.
- **Gmail changes:** the script relies on Gmail's page structure and English "Send" labels. If Google changes that structure, the selectors near the top of the script may need updating.
