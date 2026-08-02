# RECONNAISSANCE REPORT — isimm.rnu.tn

## Target
https://isimm.rnu.tn/public/

## Phase
Reconnaissance (web-application, full scope)

## Tooling notes
- Most built-in wrappers (http_request, headers_check, dir_brute, whatweb) were unavailable in this environment.
- MCP `curl` was the only reliable HTTP client; used throughout.

## Fingerprint
- **Platform: Laravel** custom application with Drupal 7 static assets co-located.
  - Root page loads Drupal module/theme CSS and uses Drupal-style `misc/`, `modules/system/` paths.
  - Auth pages (`/login`, `/register`) are custom Laravel blade views, author tag "Nachd-IT".
  - 404 handler is Laravel's default (`resources/views/errors/...`, Nunito font).
- **Front proxy / CDN**: `Server: elb` (Elastic Load Balancer), `Content-Security-Policy: frame-ancestors https://*.rnu.tn;`
- Additional session cookie from an origin gateway: `cookiesession1` (persistent, 1-year, HttpOnly).

## Observed stack / versions (from headers and bodies)
- Laravel session + XSRF-TOKEN cookies (encrypted, `laravel_session` identifier).
- Laravel error page (Symfony/HTML) with the Nunito font (Laravel 5.8+–8.x style).
- Drupal 7 asset paths (system.base / system.menus etc. with `?ogzjde` query) — either a legacy Drupal site export or statically served files.
- Custom auth system ("Nachd-IT").

## Key findings

### 1. Information disclosure — Laravel debug stack trace (HIGH value)
- **URL**: `https://isimm.rnu.tn/public/password/reset`
- **Status**: 500
- **Error**: `View [layouts.app] not found` (missing blade layout → broken route/scaffold).
- **Leaked local paths**:
  - `/home/isimm/www`
  - `/home/isimm/www/resources/views/auth/passwords/email.blade.php`
  - `/home/isimm/www/vendor/laravel/framework/src/Illuminate/View/FileViewFinder.php`
- **Implication**: `APP_DEBUG=true` or equivalent is enabled in production. Full stack traces, local paths, view names and framework internals are exposed. Also reveals the app root is `/home/isimm/www`.

### 2. Authentication attack surface
- `/public/login` — 200, full login form (XSRF + Laravel session).
- `/public/register` — 200, full account creation form.
- `/public/admin` — 302 → `/public/admin/login`.
- `/public/admin/login` — 302 → `/public/login` (unified auth).
- `/public/password/reset` — 500 (stack trace leak, see above).

### 3. Non-existent / not exposed debug surfaces
- `/public/_ignition/health-check` → 404 (no Ignition endpoint).
- `/public/telescope` → 404 (no Telescope).
- `/public/CHANGELOG.txt` → 404.
- `/public/.env` → 500 (confirms file not served; origin error page shown).
- `/public/robots.txt` → 200, empty disallow (no hints).

## Security headers (observed)
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: SAMEORIGIN` ✅
- `Content-Security-Policy: frame-ancestors https://*.rnu.tn;` ✅ (partial CSP)
- Missing: `Strict-Transport-Security` (HSTS) ⚠️, full CSP ⚠️, `Referrer-Policy` ⚠️.

## Cookies
- `laravel_session`: HttpOnly, Path=/, Max-Age=7200.
- `XSRF-TOKEN`: Path=/, Max-Age=7200 (not HttpOnly).
- `cookiesession1`: persistent (1 year), HttpOnly — origin gateway/appliance session cookie.

## Suggested next steps (post-recon)
1. **Exploit the debug stack-trace leak**: probe Laravel routes/parameters that trigger further error details (LFI via error messages, `APP_KEY` exposure via crafted exceptions).
2. **Brute-force / enumerate authentication**: user enumeration on `/login` and `/register`, default creds on admin.
3. **Probe `.env` / config leakage** variants: `/../.env`, `/.env.backup`, `/.env.old`, `/public/.env.example`.
4. **Directory baseline**: enumerate Laravel + Drupal routes (`/api`, `/storage`, `/vendor`, `/cron.php`, `/update.php`, `/install.php`).
5. **Test HTTP method tampering** on auth endpoints (GET->POST on password reset).
6. **Check subdomains** (`api.`, `mail.`, `intranet.`, `dev.` under `isimm.rnu.tn`) for additional attack surface.
7. **Check `cookiesession1` session fixation / cookie handling** across the unified auth.

## Endpoints mapped
| Method | URL | Status | Note |
|---|---|---|---|
| GET | `/public/` | 200 | Drupal-styled home |
| GET | `/public/robots.txt` | 200 | no disallow |
| GET | `/public/login` | 200 | custom login form |
| GET | `/public/register` | 200 | account creation |
| GET | `/public/admin` | 302 → /admin/login | admin area |
| GET | `/public/admin/login` | 302 → /login | unified auth |
| GET | `/public/password/reset` | 500 | debug stack trace leak |
| GET | `/public/_ignition/health-check` | 404 | no Ignition |
| GET | `/public/telescope` | 404 | no Telescope |
| GET | `/public/.env` | 500 | not served |
| GET | `/public/CHANGELOG.txt` | 404 | n/a |
