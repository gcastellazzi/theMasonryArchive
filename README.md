# The Masonry Archive

The Masonry Archive is an open, moderated web archive for geolocated masonry images. It is designed for public consultation, student teaching, and research-oriented documentation of masonry textures, structural details, construction periods, and optional aLoTiA JSON records.

## Current scope

- Public map based on OpenStreetMap tiles.
- Zoom-dependent grouping of image records.
- Public consultation without login.
- Registration-aware upload form for students, PhD candidates, researchers, and professionals.
- Moderation model where uploads become public only after administrator approval.
- Admin review queue mockup.
- Initial data model for future backend integration.
- GitHub Pages compatible static build.

## Recommended production architecture

GitHub Pages can host the frontend, but it cannot safely handle image uploads, passwordless login, email delivery, CAPTCHA verification, or protected administrator actions on its own.

Recommended setup:

- Frontend: GitHub Pages.
- Authentication: passwordless magic links through Supabase Auth or Firebase Auth.
- Database: Supabase Postgres or Firebase Firestore.
- Image storage: Supabase Storage, Cloudflare R2, or Firebase Storage.
- Email notifications: Supabase Edge Function plus Resend, or another transactional email service.
- CAPTCHA: Cloudflare Turnstile or hCaptcha.
- Moderation: administrator dashboard updates record status from `pending` to `approved`.

## Content and licensing

The application source code can be released under the MIT License.

Images, notes, and metadata should use a content license instead of MIT. Recommended options:

- CC BY 4.0 if contributors must be credited.
- CC0 if the archive should place contributions as close as possible to the public domain.

Every upload should require the contributor to confirm that they own the image or have the right to publish it.

## Image policy

Initial proposal:

- Accepted formats: JPG, PNG, WebP.
- Maximum original upload size: 12 MB.
- Public derivatives: 1600 px long edge for detail view, 480 px thumbnail for maps and lists.
- Store original only if needed for research and if contributor consent is explicit.

## Development

```bash
npm install
npm run dev
```

Local app URL:

```text
http://127.0.0.1:5173/theMasonryArchive/
```

Production build:

```bash
npm run build
```

## GitHub Pages

The Vite base path is configured for:

```text
https://gcastellazzi.github.io/theMasonryArchive/
```

Enable GitHub Pages with "GitHub Actions" as the source, then push the repository. The included workflow builds and publishes the `dist` folder.
