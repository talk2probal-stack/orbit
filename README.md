# Orbit

A private dashboard for your days. Plain HTML, no build step, hosted on Vercel.

## Cloud sync (free, Firebase Spark plan)

Data is always saved on the device first. With cloud sync on, it is also kept in
Firestore (`users/{uid}`) and merged across every device signed in with the same
Google account.

Files:
- `sync.js` loads Firebase from gstatic, handles Google sign-in and syncing.
- `merge.js` merges two devices' changes (entries matched by id, deletes respected).
- `firebase-config.js` holds the Firebase web config. Sync stays off while it is `null`.
- `firestore.rules` must be published in Firebase console > Firestore > Rules.

Setup:
1. Create a Firebase project, enable Authentication > Google.
2. Create a Firestore database and publish `firestore.rules`.
3. Add a Web app, paste its config into `firebase-config.js`.
4. Authentication > Settings > Authorized domains: add the Vercel domain.
5. Deploy. In Orbit: More > Settings and backup > Cloud sync > Sign in with Google.
