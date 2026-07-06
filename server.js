const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const csrf = require('csurf');

const config = require('./config/config');
require('./database/init'); // ensure schema exists on boot (also runs migrations, see database/init.js)

const { helmetMiddleware, generalLimiter, permissionsPolicy } = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { accessLogStream, logError } = require('./utils/logger');
const { organizationJsonLd, websiteJsonLd } = require('./utils/seo');
const Setting = require('./models/Setting');
const Category = require('./models/Category');

const app = express();

// ----- Core middleware -----
app.set('trust proxy', 1); // needed for secure cookies behind a reverse proxy (VPS + nginx)

// UPGRADE: log to a file in production (for tailing/shipping to a log
// aggregator later) while keeping the readable 'dev' console format locally.
// Previously this only ever went to stdout.
app.use(morgan(config.env === 'development' ? 'dev' : 'combined', {
  stream: config.env === 'production' ? accessLogStream : undefined
}));

// UPGRADE (bugfix): `compression()` was previously registered twice — once
// here and again just above the static file middleware further down. The
// second registration was dead weight (Express would run the gzip/deflate
// logic twice on every response for no benefit). It's now registered once.
app.use(compression());

app.use(helmetMiddleware);
app.use(permissionsPolicy); // UPGRADE: locks down camera/mic/geolocation/payment APIs site-wide
app.use(generalLimiter);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'database') }),
  secret: config.sessionSecret,
  name: 'sid',
  resave: false,
  saveUninitialized: false,
  rolling: true, // UPGRADE: sliding expiration — an active admin session keeps renewing instead of hard-expiring at 8h
  cookie: {
    httpOnly: true,
    // UPGRADE: 'strict' instead of 'lax'. Nothing on this site relies on the
    // session cookie being sent on a cross-site navigation (there's no
    // OAuth-style redirect flow into /admin), so the stricter setting closes
    // off more CSRF/session-riding surface with no functional downside.
    sameSite: 'strict',
    secure: config.env === 'production',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(csrf());

// ----- Static assets -----
// UPGRADE: uploads now get a far-future, CDN-friendly cache header since
// filenames are content-addressed-ish (timestamp + random hex, never
// reused), so there's no risk of serving a stale file under an old URL.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '365d',
  immutable: true,
  etag: true
}));

// UPGRADE: prefer public/dist (minified build output from `npm run build`,
// see utils/build.js) when it exists in production; otherwise fall back to
// the original public/ source files untouched. Nothing breaks if you never
// run the build step.
const fs = require('fs');
const distDir = path.join(__dirname, 'public', 'dist');
const hasDist = config.env === 'production' && fs.existsSync(distDir);
if (hasDist) {
  app.use(express.static(distDir, { maxAge: '30d', etag: true }));
}
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: config.env === 'production' ? '7d' : 0,
  etag: true
}));

// ----- View engine -----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Organization/WebSite JSON-LD is identical on every request, so it's built
// once at startup rather than re-serialized per request.
const orgJsonLdCached = organizationJsonLd();
const websiteJsonLdCached = websiteJsonLd();

// ----- Globals available to every view -----
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  res.locals.config = config;
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.settings = Setting.all();
  res.locals.navCategories = Category.all().slice(0, 6);
  res.locals.organizationJsonLd = orgJsonLdCached;
  res.locals.websiteJsonLd = websiteJsonLdCached;
  next();
});

// ----- Routes -----
app.use('/', require('./routes/seo'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/search'));
app.use('/', require('./routes/userFeatures'));
app.use('/', require('./routes/index'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/video')); // keep last: has broad /:slug-style patterns via /video/:slug and /category/:slug

// ----- 404 + error handling -----
app.use(notFoundHandler);
app.use(errorHandler);

// UPGRADE: previously an uncaught exception or unhandled promise rejection
// (e.g. a bug in a rarely-hit code path) could crash the whole process with
// no record of why. These are now logged to logs/error.log before exiting,
// which also plays nicely with PM2 restarting the process automatically.
process.on('uncaughtException', (err) => {
  logError(err, { fatal: true, type: 'uncaughtException' });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError(reason instanceof Error ? reason : new Error(String(reason)), { fatal: false, type: 'unhandledRejection' });
});

app.listen(config.port, () => {
  console.log(`${config.siteName} running at ${config.siteUrl} (${config.env})`);
});
