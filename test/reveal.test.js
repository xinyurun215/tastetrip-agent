import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
// Exercise the real reveal helper with the observer boundary controlled.
const helper = main.slice(main.indexOf('function armReveal('), main.indexOf('\nasync function run('));
function reveal({ visibleRatio, reducedMotion = false, shellPanel = true }) {
  const classes = new Set();
  const node = {classList:{add:value=>classes.add(value)},closest:()=>shellPanel ? {} : null};
  let observers = 0;
  class Observer {
    constructor(callback, options) { this.callback=callback; this.options=options; observers++; }
    observe(target) {
      // A tall panel in a nested scroller can be visible without ever reaching 16%.
      if (visibleRatio >= this.options.threshold) this.callback([{target,isIntersecting:visibleRatio > 0}]);
    }
    unobserve() {}
  }
  const context=vm.createContext({document:{querySelectorAll:()=>[node]},window:{matchMedia:()=>({matches:reducedMotion}),IntersectionObserver:Observer},IntersectionObserver:Observer});
  vm.runInContext(`${helper}\narmReveal();`,context);
  return {visible:classes.has('is-in'),observers};
}
test('a tall result panel becomes visible when only a small part enters its scroll viewport',()=>{
  assert.deepEqual(reveal({visibleRatio:335 / 3441}),{visible:true,observers:0});
});
test('unrelated offscreen reveals keep their animation; reduced motion never waits',()=>{
  assert.equal(reveal({visibleRatio:0,shellPanel:false}).visible,false);
  assert.deepEqual(reveal({visibleRatio:0,reducedMotion:true,shellPanel:false}),{visible:true,observers:0});
});
