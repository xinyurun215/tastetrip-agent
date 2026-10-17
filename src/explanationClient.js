import { validateExplanationResponse, validateExplanationSnapshot } from './explanationEvidence.js';

// This build-time flag only exposes the action; the server independently permits calls.
export const localExplanationsEnabled = import.meta.env?.DEV === true || import.meta.env?.VITE_EXPLANATIONS_ENABLED === 'true';

export function createExplanationClient({fetchImpl = globalThis.fetch} = {}) {
  const cache = new Map();
  let snapshot = null, key = null, generation = 0, controller = null, pending = null;
  let state = {status:'unavailable'};
  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null; pending = null; snapshot = null; key = null;
    state = {status:'unavailable'};
  }
  function setSnapshot(value) {
    if (!value) { invalidate(); return; }
    const next = validateExplanationSnapshot(value);
    const nextKey = JSON.stringify(next);
    if (key === nextKey) return;
    invalidate();
    snapshot = next; key = nextKey;
    state = cache.has(key) ? {status:'ready',explanation:cache.get(key),cached:true} : {status:'idle'};
  }
  function request() {
    if (!snapshot || state.status === 'ready') return Promise.resolve(state);
    if (pending) return pending;
    const current = generation, currentKey = key, currentSnapshot = snapshot;
    controller = new AbortController();
    const signal = controller.signal;
    state = {status:'loading'};
    pending = (async () => {
      try {
        const response = await fetchImpl('/api/explain', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(currentSnapshot),signal});
        if (!response.ok) throw new Error('unavailable');
        const value = await response.json();
        if (value?.ok !== true) throw new Error('unavailable');
        const explanation = validateExplanationResponse(value.explanation,currentSnapshot);
        if (current !== generation) return state;
        cache.set(currentKey,explanation);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        state = {status:'ready',explanation,cached:Boolean(value.cached)};
      } catch {
        if (current === generation) state = {status:'error'};
      } finally {
        if (current === generation) { pending = null; controller = null; }
      }
      return state;
    })();
    return pending;
  }
  return {setSnapshot,invalidate,request,get state() { return state; }};
}
