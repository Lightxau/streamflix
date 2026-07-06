# StreamFlix

A production-ready, Netflix-inspired video streaming platform. StreamFlix **does not host or download
video files** — it publishes videos by storing metadata (title, description, tags, thumbnail) alongside
an **embed URL** from a platform that explicitly permits embedding (YouTube, Vimeo, Dailymotion, TED).
Playback happens entirely inside that platform's official `<iframe>` player.

Built with:
- **Frontend:** Server-rendered EJS templates, vanilla HTML5/CSS3/JavaScript (no framework/build step required)
- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`) — swappable for MySQL later
- **Auth:** `express-session` + `bcrypt` password hashing (admin only — there are no visitor accounts)

> **This README documents an upgraded version of the original project.** The folder structure, coding
> style, and every existing feature were preserved; the sections below explain what changed and why.
> See **"What changed in this upgrade"** near the bottom for a fast summary if you already know the app.

---

## Features

- Responsive, mobile-first dark theme with sticky nav, hero banner, skeleton loading states, and smooth animations
- Home page: hero, featured, **Popular This Week**, trending, recently added, **Continue Watching** (device-local), categories
- Video detail page: embedded player, metadata, tags, related videos (tag-overlap scored), share buttons, local Like + **Favorite/Save**, view count
- Instant search suggestions, full search results with sorting, **infinite scroll / Load More**, and a no-results state
- Category pages with sorting, filtering, pagination, and infinite scroll
- **/favorites** and **/history** pages (device-local, no account needed)
- Secure admin dashboard: video CRUD, **draft/scheduled/published status**, **bulk actions** (delete, feature, status, re-category), category CRUD, thumbnail upload with **automatic WebP optimization + responsive srcset**, SEO fields, **analytics (daily/weekly/monthly views, top categories, storage usage)**, site settings
- SEO: dynamic titles/meta descriptions, canonical URLs, Open Graph + Twitter Card tags, JSON-LD `VideoObject`, **`Organization`, `WebSite` (with SearchAction), and `BreadcrumbList`** schema, auto-generated `sitemap.xml` (with **image sitemap** entries), `robots.txt`, and an **RSS feed**
- Security: bcrypt password hashing, CSRF protection, input validation & sanitization, rate limiting, hardened Helmet headers (CSP, HSTS, Referrer-Policy, Permissions-Policy), strict session cookies, allow-listed embed hosts, file-based error logging
- **PWA**: installable (manifest + custom install prompt), offline fallback page, service worker app-shell caching
- Accessible: skip link, keyboard-navigable focus states, labeled form fields, `aria-live` toasts, `aria-current` pagination

---

## 1. Installation

```bash
git clone <your-repo-url> streamflix
cd streamflix
npm install
cp .env.example .env
```

Edit `.env` and set at minimum a strong `SESSION_SECRET` and your desired `ADMIN_USERNAME` /
`ADMIN_PASSWORD` (used only the first time the database is seeded).

Optional but recommended:
```bash
npm run icons   # generates PNG app icons (manifest.json) from the source SVG, via sharp
```

## 2. Database setup

```bash
npm run init-db   # creates database/streamflix.db, and migrates an existing DB to the latest schema
npm run seed       # creates the admin user + example categories/videos (optional but recommended)
```

`npm run init-db` is **safe to re-run against an existing database** — see "Database" below for how the
migration step works. The seed script is idempotent too — running it again won't duplicate the admin
user or sample data.

## 3. Running locally

```bash
npm run dev    # nodemon, auto-restarts on file changes
# or
npm start      # plain node
```

Visit `http://localhost:3000`. Sign in at `/login` with the admin credentials from your `.env` file.

**Change the seeded admin password immediately** if you plan to deploy this publicly.

---

## Folder structure

```
streamflix/
├── server.js                 # app entry point — middleware + route wiring
├── ecosystem.config.js         # PM2 process config
├── Dockerfile / docker-compose.yml / .dockerignore
├── config/                       # env config + database connection
├── database/                       # schema + migrations (init.js) and seed data (seed.js)
├── models/                           # Video, Category, User, Setting (raw SQL via better-sqlite3)
├── controllers/                        # request handlers per feature area
├── routes/                               # Express routers, mounted in server.js
├── middleware/                             # auth guard, validation rules, security, uploads, error handling
├── utils/                                   # SEO helpers, sitemap/RSS generator, sanitizer, pagination, logger, image optimizer
├── scripts/                                  # one-off scripts: build.js (minify), generate-icons.js
├── deploy/                                     # nginx.conf.example
├── views/                                        # EJS templates
│   ├── partials/                                   # head, navbar, footer, video card, pagination, admin sidebar
│   └── admin/                                        # admin dashboard views
├── public/
│   ├── css/style.css                                    # single stylesheet, design tokens at the top
│   ├── js/                                                # main, cards, search, history, infinite-scroll, video, admin, pwa
│   ├── images/                                              # placeholder thumbnail, OG image, app icons
│   ├── manifest.json / sw.js / offline.html                   # PWA
│   └── dist/                                                    # generated by `npm run build` — minified CSS/JS (gitignored)
├── uploads/thumbnails/                                             # uploaded/optimized thumbnail images (gitignored)
└── logs/                                                              # access.log / error.log (gitignored, created on boot)
```

---

## Adding videos (Admin Dashboard)

1. Log in at `/login`.
2. Go to **Videos → Add Video**.
3. Paste an **embed URL** — the exact `src` you'd use in an `<iframe>`, e.g.
   `https://www.youtube.com/embed/VIDEO_ID` or `https://player.vimeo.com/video/VIDEO_ID`.
4. Fill in title, description, category, tags, duration, and optionally upload a thumbnail (it's
   automatically resized and converted to WebP — see "Performance" below).
5. Set **Status**:
   - **Published** + today's (or a past) publish date → live immediately.
   - **Published** + a **future** publish date → this is how **scheduled publishing** works: the video
     is hidden from all visitor-facing pages until that date arrives, with no separate "scheduled" status
     to manage — it just becomes visible automatically.
   - **Draft** → never shown publicly regardless of publish date, until you switch it back to Published.
6. Toggle **Feature this video** to show it in the homepage hero/featured rail.

The embed URL is validated against an allow-list of hosts known to support embedding
(`middleware/validation.js` → `ALLOWED_EMBED_HOSTS`). Add more hosts there if you have a specific,
permitted embeddable source you'd like to support.

### Bulk actions

On **Videos**, select multiple rows with the checkboxes, choose an action (Delete, Feature/Unfeature,
Publish/Draft, or Move to category) from the dropdown above the table, and click **Apply to Selected**.
Destructive actions (delete) ask for confirmation first.

### Search, sort, and filter

The admin video table has its own search box, status filter (draft vs. published/scheduled), and sort
control, independent of the public site's search.

---

## Database

`npm run init-db` creates the schema **and runs lightweight migrations** for databases created by an
earlier version of this app. SQLite's `CREATE TABLE IF NOT EXISTS` doesn't retroactively add columns to a
table that already exists with an older shape, so `database/init.js` also inspects each table with
`PRAGMA table_info` and `ALTER TABLE ... ADD COLUMN`s in anything missing (currently: `videos.status` and
`videos.thumbnail_srcset`). This is safe to run against a database that already has real data in it, and
runs automatically every time the server boots (`require('./database/init')` in `server.js`), so you don't
need to remember to run it by hand after pulling an upgrade — though `npm run init-db` still works
standalone if you want to run it explicitly (e.g. as part of a deploy script, before starting the app).

New in this upgrade:
- **`videos.status`** (`draft` | `published`) plus the existing `publish_date` together implement
  draft/scheduled/published (see "Adding videos" above).
- **`videos.thumbnail_srcset`** stores the responsive `srcset` string generated when a thumbnail is optimized.
- **`video_view_events`** — one row per playback start, powering the analytics dashboard and a
  recency-weighted trending algorithm (see "User Features" below). This is additive and doesn't change
  the existing `videos.views` lifetime counter, which still works exactly as before.
- New indexes: `idx_videos_status`, `idx_videos_publish_date`, `idx_videos_views`,
  `idx_view_events_video`, `idx_view_events_created` — see "Performance" below.

### Switching to MySQL later

The model layer (`models/*.js`) is the only place with SQL. To move to MySQL: swap `better-sqlite3` for a
MySQL driver (e.g. `mysql2`) in `config/database.js`, update each model's queries to use the driver's
(likely async) query API, and re-create the schema from `database/init.js` using MySQL-compatible types.
Because routes/controllers call model methods rather than writing SQL directly, this stays a contained change.

---

## SEO

- Every page renders dynamic `<title>`, meta description, canonical URL, Open Graph, and Twitter Card
  tags via `views/partials/head.ejs` and `utils/seo.js`.
- **New:** every page also emits sitewide `Organization` and `WebSite` (with a `SearchAction`, enabling
  Google's sitelinks search box) JSON-LD, computed once at server startup (`server.js`) rather than
  per-request, since it's identical on every page.
- Video pages emit `VideoObject` and `BreadcrumbList` JSON-LD (unchanged).
- `/sitemap.xml` is generated **live from the current database** on every request — there's no separate
  "regenerate" step or cache to go stale, so a video added or deleted is reflected immediately. It's
  reachable at the site root (`https://yourdomain.com/sitemap.xml`) as required by the sitemap protocol.
- **New:** sitemap entries for videos now include an `<image:image>` tag (the Image Sitemap extension),
  and `/rss.xml` provides a feed of recently published videos.
- `/robots.txt` references the sitemap and now also disallows crawling `/api/` routes (which return JSON,
  not indexable pages).
- Set `GOOGLE_SITE_VERIFICATION`, `GOOGLE_ANALYTICS_ID`, and the new `GOOGLE_TAG_MANAGER_ID` in `.env` to
  enable the verification meta tag, GA4, and GTM respectively.
- **Internal linking:** related videos are now scored by tag overlap first (falling back to
  same-category, then trending) instead of only "same category", surfacing more relevant links; category
  and tag links throughout video cards/detail pages are unchanged.

---

## Performance

- **New — image optimization:** uploaded thumbnails are automatically resized to 320w/640w and converted
  to WebP via `sharp` (`utils/imageOptimizer.js`), and templates render a real `srcset`/`sizes` pair
  (`views/partials/video-card.ejs`, `public/js/cards.js`) instead of a single fixed-size image. If `sharp`
  isn't installed yet (e.g. you haven't re-run `npm install` after pulling this upgrade), video
  creation/editing still succeeds — it falls back to serving the original uploaded file untouched and logs
  a warning, rather than failing the request.
- **New — database indexes:** `idx_videos_status`, `idx_videos_publish_date`, `idx_videos_views`, and two
  indexes on `video_view_events`, keeping the new status filters and analytics queries fast as the video
  count grows.
- **New — minified production assets:** `npm run build` (see `scripts/build.js`) minifies `public/css` and
  `public/js` into `public/dist`. `server.js` automatically prefers `public/dist` over `public/` when
  `NODE_ENV=production` and that folder exists — otherwise it just serves the original readable source
  files, so skipping this step never breaks anything.
- **New — CDN-ready caching:** `/uploads` now gets a far-future, `immutable` cache header (filenames are
  timestamp+random and never reused, so this is safe), making it easy to front with a CDN later.
- **Bugfix:** the `compression()` gzip/deflate middleware was previously registered **twice** in
  `server.js` (once near the top, once again just above the static file middleware) — every response was
  being compressed twice for no benefit. It's now registered exactly once.
- Lazy-loaded, fixed-aspect-ratio images (unchanged from the original) continue to avoid layout shift.
- Responsive images (`srcset`) are new — see above. Full CDN/image-service integration is a further step
  the folder structure already supports (swap `imageOptimizer.js`'s destination for a bucket/CDN).

---

## Security

- Passwords hashed with `bcrypt` (cost factor 12) — unchanged.
- CSRF tokens (`csurf`) required on every state-changing form — unchanged.
- **Improved:** session cookie `sameSite` tightened from `lax` to `strict` (nothing on this site relies on
  the cookie being sent on a cross-site navigation), and sessions are now `rolling: true` (an active admin
  session's expiry slides forward instead of hard-expiring at a fixed 8 hours).
- **Improved Helmet config:** explicit `Referrer-Policy: strict-origin-when-cross-origin`, `HSTS` enabled
  in production only, and a new `Permissions-Policy` header disabling camera/microphone/geolocation/payment
  APIs site-wide.
- Input validated with `express-validator`; text fields sanitized with `xss` before storage — unchanged.
- SQL access goes exclusively through parameterized queries in `models/` — unchanged, and the new bulk
  operations (`bulkDelete`, `bulkSetCategory`, etc.) follow the same pattern.
- **New — logging:** `utils/logger.js` writes every server error to `logs/error.log` (in addition to the
  console), and access logs are written to `logs/access.log` in production via `morgan`. Uncaught
  exceptions and unhandled promise rejections are now caught at the process level and logged before the
  process exits, instead of crashing silently.
- **Bugfix (code review):** creating or renaming a category to a name that already exists previously hit
  the database's `UNIQUE` constraint directly and returned a raw, unhandled 500 error. `adminController.js`
  now checks for a duplicate name first and shows a friendly flash message instead.
- File upload validation (mimetype allow-list, 5MB limit) — unchanged, now paired with the image
  optimization step which also implicitly re-encodes the file (stripping anything malformed about the
  original beyond what the mimetype check alone would catch).
- General + login-specific rate limiting — unchanged.

---

## Admin Dashboard

The dashboard (`/admin`) now shows, in addition to the original total videos / total views / top-videos
table:
- **Published / Draft / Scheduled counts**, each broken out separately
- **Views — Last 14 Days**, a small dependency-free CSS bar chart
- **Weekly views** (last 8 weeks) and **Monthly views** (last 6 months) tables
- **Top Categories** by total views
- **Recently Uploaded** videos
- **Thumbnail storage usage** (sum of files in `uploads/thumbnails`)

All of this is driven by the new `video_view_events` log table (see "Database" above) plus existing
columns — no external analytics service required. If you already have Google Analytics/GTM configured via
`.env`, that remains a separate, complementary source of visitor-level analytics; this dashboard is
first-party and privacy-friendly by construction (it only ever counts a view, never anything about *who*
viewed).

---

## User Features (Continue Watching / Favorites / History)

StreamFlix has **no visitor account system** — only the admin login used to manage content. Implementing
real per-user accounts (sign-up, password reset, etc.) would be a significant, separate feature and wasn't
something this upgrade should bolt on silently, so instead:

- **Continue Watching**, **Watch History** (`/history`), and **Favorites** (`/favorites`) are implemented
  **entirely client-side** with `localStorage`, keyed per browser/device (`public/js/history.js`). Nothing
  about which videos a visitor has watched or favorited is sent to or stored on the server — the only
  network call these features make is a read-only lookup (`GET /api/videos-by-slugs`) that turns the
  slugs already sitting in the visitor's own `localStorage` into full video cards.
- **Why "Continue Watching" doesn't resume playback position:** videos play inside a cross-origin
  third-party `<iframe>` (YouTube/Vimeo/etc.), and a page cannot read playback state from a cross-origin
  iframe — that's a deliberate browser security boundary, not a bug. "Continue Watching" here means
  "recently opened," which is the most this architecture can honestly offer without hosting video files
  yourself or requiring visitors to sign in through each platform's own SDK.
- **Better trending algorithm:** `Video.trending()` now computes a recency-weighted score from
  `video_view_events` (a view from an hour ago counts for much more than one from six months ago) instead
  of ranking purely by lifetime view count, so stale-but-once-popular videos stop permanently occupying
  the trending rail.
- **Popular This Week:** a separate, simpler ranking by raw view count in the last 7 days — shown as its
  own homepage rail alongside (not replacing) the decayed all-time Trending rail.
- **Recommended/Related videos:** now scored primarily by shared tags, falling back to same-category, then
  to general trending videos if there aren't enough close matches — previously this was same-category only.

---

## UI Improvements

- **Infinite scroll / Load More:** category and search pages progressively enhance their existing
  server-rendered numbered pagination — with JavaScript enabled, `public/js/infinite-scroll.js` hides the
  page-number links and replaces them with a "Load More" button (and auto-loads near the bottom of the
  page via `IntersectionObserver`) that fetches additional pages from a new `GET /api/videos` JSON
  endpoint and appends cards using the same renderer as the history/favorites pages. With JavaScript
  disabled, the original numbered pagination works exactly as before — nothing is removed, only layered on top.
- **Accessibility:** the toast container is now an `aria-live="polite"` region so notifications are
  announced to screen readers; the current pagination page gets `aria-current="page"`.
- Loading skeleton styles, toast notifications, mobile navigation, and responsive layouts are unchanged
  from the original.

---

## PWA

StreamFlix is now installable:
- **`public/manifest.json`** — name, theme colors, and icons (SVG icons ship ready-to-use; run
  `npm run icons` once after `npm install` to also generate real PNG variants, including a maskable icon,
  via `scripts/generate-icons.js`/`sharp` — recommended for best iOS/Android compatibility but not required
  for the manifest to work).
- **`public/sw.js`** — a service worker that caches the static app shell (CSS/JS/icons) for instant repeat
  loads, and serves `public/offline.html` as a fallback when a page navigation fails with no network. It
  deliberately never intercepts `/admin`, `/api/`, `/login`, or `/logout` requests, so session/CSRF/auth
  behavior is unaffected.
- **Install prompt:** `public/js/pwa.js` registers the service worker and shows a custom "Install App"
  button (bottom-right) when the browser's `beforeinstallprompt` event fires (Chrome/Edge/Android). Safari
  doesn't support this API — on iOS, installing is via the native Share → Add to Home Screen flow, which
  can't be triggered programmatically, so the button simply never appears there.

---

## Deployment

### Option A — Docker

```bash
cp .env.example .env   # edit with production values
docker compose up -d --build
```

This builds the image (`Dockerfile`), runs the minify + icon-generation steps automatically, and persists
the database, uploads, and logs in named volumes (`docker-compose.yml`) so they survive container
rebuilds. Put nginx + certbot in front for HTTPS — see the commented-out `nginx` service in
`docker-compose.yml` and `deploy/nginx.conf.example`, or run nginx directly on the host as in Option B.

### Option B — VPS with PM2 + nginx

1. **Provision a VPS** (Ubuntu 22.04+ recommended) and SSH in.
2. **Install Node.js 18+ and PM2:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```
3. **Clone and configure the app:**
   ```bash
   git clone <your-repo-url> /var/www/streamflix
   cd /var/www/streamflix
   npm install --omit=dev
   cp .env.example .env   # then edit with production values
   npm run init-db
   npm run seed            # optional
   npm run icons            # optional, generates PNG PWA icons
   npm run build              # optional, minifies public/css and public/js
   ```
4. **Start with PM2** using the included config:
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup   # follow the printed instructions to enable boot-start
   ```
5. **Reverse proxy with nginx** — copy `deploy/nginx.conf.example` to
   `/etc/nginx/sites-available/streamflix`, edit `server_name`, then:
   ```bash
   sudo ln -s /etc/nginx/sites-available/streamflix /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
6. **Point your domain's DNS** A record to the VPS's IP address.
7. **Enable HTTPS with Let's Encrypt:**
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```
   Certbot rewrites the nginx config to add the TLS server block and an HTTP→HTTPS redirect, and sets up
   auto-renewal.
8. Update `.env` on the server: `NODE_ENV=production`, `SITE_URL=https://yourdomain.com`, then
   `pm2 restart streamflix`.

### Environment variables reference

| Variable | Description |
|---|---|
| `PORT` | Port the Node process listens on (default `3000`) |
| `NODE_ENV` | `development` or `production` |
| `SITE_URL` | Full public URL, used for canonical/OG tags, JSON-LD, and the sitemap/RSS feed |
| `SITE_NAME` | Display name used throughout the site |
| `SESSION_SECRET` | Long random string — required, never reuse the example value |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Used only by `npm run seed` on first run |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | General rate limiting window and cap |
| `GOOGLE_SITE_VERIFICATION` | Optional Search Console verification meta tag value |
| `GOOGLE_ANALYTICS_ID` | Optional GA4 measurement ID |
| `GOOGLE_TAG_MANAGER_ID` | Optional GTM container ID (new) |

---

## Troubleshooting

- **"CSRF token invalid" on form submit** — make sure every form includes
  `<input type="hidden" name="_csrf" value="<%= csrfToken %>">` and that cookies are enabled in the browser.
- **Login always fails** — confirm you ran `npm run seed` (or created a user manually); changing
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env` afterward does not retroactively change the stored password hash.
- **Thumbnails 404 after upload** — confirm `uploads/` is writable by the Node process. If you just
  upgraded and thumbnails look unoptimized, run `npm install` again to make sure `sharp` installed
  correctly (see the console/`logs/error.log` for an "image optimization" warning if it silently fell back).
- **Embed URL rejected** — the URL's host must match the allow-list in `middleware/validation.js`
  (`ALLOWED_EMBED_HOSTS`); add your platform there if it genuinely supports embedding.
- **A video isn't showing up on the site even though it's "Published"** — check its **Publish Date**; a
  future date means it's scheduled and will appear automatically once that date arrives (see "Adding
  videos" above).
- **Analytics charts on the dashboard are empty** — they're built from view *events*, which only start
  accumulating after this upgrade is deployed; the lifetime `views` counter (used everywhere else) is
  unaffected and keeps its historical value.
- **Manifest/PWA icons look wrong on iOS** — run `npm run icons` to generate real PNG variants; iOS doesn't
  reliably support SVG manifest icons.
- **Styles look unstyled/broken** — check the network tab for a 404 on `/css/style.css`, and make sure no
  reverse-proxy rule is blocking `/css`, `/js`, or (if you ran `npm run build`) `/dist`.
- **Sessions reset on every deploy** — the SQLite session store (`database/sessions.sqlite`) persists
  across restarts as long as the file isn't deleted; back it up like the main database if you want logins
  to survive a redeploy.

---

## What changed in this upgrade (quick reference)

- **SEO:** Organization + WebSite (SearchAction) JSON-LD sitewide, Image Sitemap extension, RSS feed,
  GTM placeholder, `/api/` disallowed in robots.txt, tag-overlap-based related-video linking.
- **Performance:** WebP thumbnail generation + responsive `srcset`, new DB indexes, minify build step
  (`npm run build`), far-future cache headers on `/uploads`, fixed a duplicate `compression()` middleware bug.
- **Security:** stricter session cookie (`sameSite: strict`, rolling expiry), hardened Helmet (HSTS,
  Referrer-Policy, Permissions-Policy), file-based error/access logging, process-level crash logging,
  friendly duplicate-category-name handling instead of a raw 500.
- **Admin dashboard:** daily/weekly/monthly view analytics, top categories, recently uploaded, storage
  usage, draft/scheduled/published status, bulk delete/feature/status/category actions, admin-side search+sort.
- **User features:** device-local Continue Watching / Favorites / Watch History, recency-weighted
  trending, Popular This Week, tag-overlap related videos.
- **UI:** infinite scroll / Load More (progressive enhancement over existing pagination), `aria-live`
  toasts, `aria-current` pagination.
- **PWA:** manifest, service worker with offline fallback, install prompt, app icons + generator script.
- **Deployment:** Dockerfile, docker-compose.yml, PM2 `ecosystem.config.js`, example nginx config.
- **Database:** `status`, `thumbnail_srcset`, and `video_view_events` added via a safe, idempotent
  migration step in `database/init.js` — existing data is untouched.
- **Code review fixes:** removed the duplicate `compression()` registration; duplicate-category-name now
  handled gracefully instead of crashing; shared client-side card-rendering logic extracted into
  `public/js/cards.js` instead of being duplicated across `history.js`/`infinite-scroll.js`.

Every existing route, view, and feature from the original project still works the same way it did before —
this upgrade only adds to and hardens what was already there.

## License

MIT — see `package.json`.
