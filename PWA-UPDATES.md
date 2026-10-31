# PWA version updates

The installed app checks `app-version.json` while it is online. When it detects a newer frontend release, it blocks the app with a mandatory update screen showing the installed and available versions. The user must choose **Update now**. This activates the waiting service worker and reloads the app. If activation fails, the screen stays in place and offers a retry message.

## Releasing an update

1. Increment the frontend version in `package.json` (and the matching root version in `package-lock.json`, for example with `npm version patch --no-git-tag-version`).
(Use patch for routine fixes, minor for a feature release (0.1.1 → 0.2.0), and major for a breaking release (0.2.0 → 1.0.0). Don’t run minor for this commit unless you specifically want to label it as a feature release.)
2. Commit and push the frontend changes.
3. Let Vercel build and deploy the frontend. The `prebuild` script generates `public/app-version.json`; it must be part of the deployed frontend output. Vercel serves this file without caching and revalidates the service worker.
4. Deploy the backend to Render too only when backend code or configuration changed. The update notice and service worker are frontend features and do not require a backend version endpoint.

Use semantic versions such as `0.1.1`, `0.2.0`, or `1.0.0`. The deployed frontend version is compiled into the app, so the package version should be changed for each frontend release. Do not edit the generated `public/app-version.json` by hand.

The check runs once on startup and then every minute while online. Browsers may throttle background tabs, and a user who leaves the app closed will see the update on the next launch. The app does not force an update: it waits for the user's choice, then reloads to activate the new cached assets. In-browser tabs do not show this installed-app prompt.
