/* Orbit sync: three-way merge of the whole app state.
   base   = the state both devices last agreed on (null on the very first sync)
   local  = this device's state now
   remote = the cloud state now
   Items in lists are matched by their id, so an entry added on the phone and
   another added on the laptop both survive. A deletion wins unless the other
   side edited that same item. When both sides changed the same value, the
   side that was saved later wins. */

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasId = v => isObj(v) && v.id != null;
const isIdArr = a => Array.isArray(a) && a.length > 0 && a.every(hasId);

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export const same = (a, b) => stable(a) === stable(b);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// On the very first sync there is no shared history, so ids made separately on
// each device (the seeded study subjects) never match. Match those by content.
function keyOf(item, path, first) {
  if (!first) return String(item.id);
  const last = path[path.length - 1];
  if (last === 'subjects') return 's:' + item.group + '|' + item.paper;
  if (last === 'chapters') return 'c:' + item.name;
  return String(item.id);
}

function mergeList(b, l, r, localNewer, first, path) {
  const bm = new Map((Array.isArray(b) ? b : []).filter(hasId).map(x => [keyOf(x, path, first), x]));
  const lm = new Map(l.map(x => [keyOf(x, path, first), x]));
  const rm = new Map(r.map(x => [keyOf(x, path, first), x]));
  const order = localNewer ? [...lm.keys(), ...rm.keys()] : [...rm.keys(), ...lm.keys()];
  const out = [], seen = new Set();
  for (const k of order) {
    if (seen.has(k)) continue; seen.add(k);
    const bi = bm.get(k), li = lm.get(k), ri = rm.get(k);
    if (li && ri) { out.push(merge3(bi, li, ri, localNewer, first && !bi, path)); continue; }
    const kept = li || ri;
    if (bi && !first) {
      // missing on one side = deleted there. Keep it only if the other side edited it.
      if (same(kept, bi)) continue;
    }
    out.push(clone(kept));
  }
  return out;
}

export function merge3(b, l, r, localNewer, first = false, path = []) {
  if (same(l, r)) return clone(l);
  if (!first && b !== undefined) {
    if (same(l, b)) return clone(r);
    if (same(r, b)) return clone(l);
  }
  const listish = x => Array.isArray(x) && (x.length === 0 || x.every(hasId));
  if (Array.isArray(l) && Array.isArray(r) && listish(l) && listish(r) && (isIdArr(l) || isIdArr(r))) {
    return mergeList(b, l, r, localNewer, first, path);
  }
  if (isObj(l) && isObj(r)) {
    const bo = isObj(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const inL = k in l && l[k] !== undefined, inR = k in r && r[k] !== undefined, inB = k in bo && !first;
      if (inL && inR) { out[k] = merge3(inB ? bo[k] : undefined, l[k], r[k], localNewer, first || !inB, [...path, k]); continue; }
      const v = inL ? l[k] : r[k];
      if (inB && same(v, bo[k])) continue; // deleted on the other side, unchanged here
      out[k] = clone(v);
    }
    return out;
  }
  return clone(localNewer ? l : r);
}

// True when a state holds nothing the person typed in (a brand-new install).
export function isPristine(s) {
  if (!s) return true;
  const lists = ['logs', 'tasks', 'sessions', 'txns', 'loans', 'moments', 'stories', 'assets'];
  if (lists.some(k => Array.isArray(s[k]) && s[k].length)) return false;
  if (['salah', 'vitals', 'budgets'].some(k => isObj(s[k]) && Object.keys(s[k]).length)) return false;
  if ((s.subjects || []).some(x => (x.chapters || []).some(c => c.steps && Object.keys(c.steps).length))) return false;
  if (s.settings && s.settings.name) return false;
  return true;
}

export function mergeStates(base, local, remote) {
  const lt = +(local && local._t) || 0, rt = +(remote && remote._t) || 0;
  if (!remote) return clone(local);
  if (!local || (!base && isPristine(local))) return clone(remote);
  const first = !base;
  // A device running an older copy of Orbit may not know about newer sections
  // (like monthly items). A section it lacks entirely is "unknown", not "deleted".
  local = { ...local };
  for (const k of Object.keys(remote)) if (!(k in local)) local[k] = clone(remote[k]);
  const out = merge3(first ? undefined : base, local, remote, lt >= rt, first);
  out._t = Math.max(lt, rt);
  return out;
}
