# Daybook Web

React, TypeScript, and Vite progressive web app. This repository is deployed as a Vercel static site; its `/api/*` requests are proxied to the Render API.

## Deploy to Vercel

1. Push this repository (`DayBook_Frontend`) to GitHub and import it in Vercel. Use the repository root as the project root, framework preset **Vite**, build command `npm run build`, and output directory `dist`.
2. Confirm the API rewrite in `vercel.json` points to the actual Render API hostname. Its default target is `https://daybook-api.onrender.com` (the Render Blueprint service name). Deploy the API first.
3. After the first frontend deployment, set the Render `FRONTEND_ORIGIN` value to this exact Vercel production origin and redeploy the API.

No API secret or frontend environment variable is needed. Keep requests same-origin through the configured rewrite: authentication uses secure HTTP-only session cookies and a CSRF token. The API is not a local mock; all account data is fetched from Render and MongoDB.

The Vercel rewrite also serves the SPA shell for deep links. PWA installation and static shell caching work where the browser supports them. Authenticated data, diary autosave, AI suggestions, and queued mutations still need the API connection; the app does not claim full offline operation.

## Local development

Run the backend API and MongoDB separately, then run `npm install` and `npm run dev` from this repository. Vite proxies `/api` to `http://localhost:4000` during local development.

## Checks

```sh
npm ci
npm test
npm run lint
npm run build
```
