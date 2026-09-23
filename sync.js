/* Orbit cloud sync (free Firebase Spark plan).
   The app keeps working from this device's own storage exactly as before.
   When signed in with Google, the whole state is also kept in one Firestore
   document, users/{uid}, and every device merges its changes into it. */
import { firebaseConfig } from './firebase-config.js';
import { mergeStates, same } from './merge.js';

const CDN = 'https://www.gstatic.com/firebasejs/12.19.0/';
const MAX_BYTES = 950000; // a Firestore document can hold about 1 MB

const st = { configured: !!firebaseConfig, loaded: false, user: null, busy: false, error: '', last: 0 };
let A, F, auth, db, ref, unsub = null, running = false, again = false, timer = null;

const App = () => window.orbitApp;
const show = () => App()?.refreshSync?.();
const setErr = m => { st.error = m || ''; show(); };

async function load() {
  if (st.loaded) return true;
  if (!st.configured) return false;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')
    ]);
    A = authMod; F = fsMod;
    const app = appMod.initializeApp(firebaseConfig);
    auth = A.getAuth(app);
    db = F.getFirestore(app);
    await A.setPersistence(auth, A.browserLocalPersistence).catch(() => {});
    A.getRedirectResult(auth).catch(e => setErr(msg(e)));
    A.onAuthStateChanged(auth, onUser);
    st.loaded = true; setErr('');
    return true;
  } catch (e) {
    setErr(navigator.onLine ? 'Could not load sync. Try again later.' : 'Offline. Sync resumes when you are online.');
    return false;
  }
}

function msg(e) {
  const c = (e && e.code) || '';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return '';
  if (c.includes('unauthorized-domain')) return 'This website is not in Firebase Authorized domains yet.';
  if (c.includes('permission-denied')) return 'Firestore rules are blocking sync. Publish the rules from the guide.';
  if (c.includes('unavailable') || c.includes('network')) return 'Offline. Sync resumes when you are online.';
  return (e && e.message) || 'Sync failed.';
}

function onUser(u) {
  if (unsub) { unsub(); unsub = null; }
  st.user = u ? { name: u.displayName || '', email: u.email || '' } : null;
  show();
  if (!u) return;
  ref = F.doc(db, 'users', u.uid);
  unsub = F.onSnapshot(ref, snap => {
    if (snap.metadata.hasPendingWrites) return;
    sync();
  }, e => setErr(msg(e)));
}

const readRemote = snap => (snap.exists() && snap.data().state ? JSON.parse(snap.data().state) : null);

async function sync() {
  if (!st.user || !App()?.ready) return;
  if (running) { again = true; return; }
  if (!navigator.onLine) { setErr('Offline. Sync resumes when you are online.'); return; }
  running = true; st.busy = true; show();
  try {
    const local = App().get();
    const base = await App().getBase();
    const merged = await F.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const remote = readRemote(snap);
      const m = mergeStates(base, local, remote);
      if (!remote || !same(m, remote)) {
        const json = JSON.stringify(m);
        if (json.length > MAX_BYTES) throw Object.assign(new Error('Your data is too large for one cloud document.'), { code: 'too-big' });
        tx.set(ref, { state: json, t: m._t || Date.now(), at: F.serverTimestamp() });
      }
      return m;
    });
    await App().setBase(merged);
    // Anything typed while we were syncing is merged on top, not lost.
    const now = App().get();
    const next = same(now, local) ? merged : mergeStates(local, now, merged);
    if (!same(next, now)) App().replace(next);
    if (!same(next, merged)) again = true;
    st.last = Date.now(); st.error = '';
  } catch (e) {
    setErr(msg(e));
  } finally {
    running = false; st.busy = false; show();
    if (again) { again = false; setTimeout(sync, 300); }
  }
}

function schedule() { clearTimeout(timer); timer = setTimeout(sync, 1500); }

async function login() {
  if (!(await load())) return;
  const p = new A.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try { await A.signInWithPopup(auth, p); }
  catch (e) {
    const c = (e && e.code) || '';
    if (c.includes('popup-blocked') || c.includes('operation-not-supported')) {
      try { await A.signInWithRedirect(auth, p); } catch (e2) { setErr(msg(e2)); }
    } else setErr(msg(e));
  }
}

async function logout() {
  if (!st.loaded) return;
  await A.signOut(auth);
  await App().setBase(null); // next sign-in merges from scratch; data on this device stays
  st.last = 0; show();
}

// Re-confirm the signed-in Google account (used to reset a forgotten app PIN).
async function reauth() {
  if (!(await load()) || !auth.currentUser) return null;
  try { const r = await A.reauthenticateWithPopup(auth.currentUser, new A.GoogleAuthProvider()); return r.user.email; }
  catch (e) { setErr(msg(e)); return null; }
}

window.orbitSync = { state: st, login, logout, reauth, now: sync, notify: schedule };

function start() { if (st.configured) load(); show(); }
if (App()?.ready) start(); else window.addEventListener('orbit-ready', start, { once: true });

window.addEventListener('online', () => { if (!st.loaded) load(); else sync(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
setInterval(() => { const a = App(); if (a?.needRender && !a.busy()) a.render(); }, 800);
