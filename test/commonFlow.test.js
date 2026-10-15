import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Real main/client/domain with a small DOM surface and synthetic HTTP responses.
async function mount(transport) {
  const url = new URL('../src/main.js', import.meta.url);
  const source=await readFile(url,'utf8');
  const imports={};
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)) {
    const module=await import(new URL(match[2],url));
    for (const name of match[1].split(',').map(value=>value.trim())) imports[name]=module[name];
  }
  imports.chooseLanguage('en');
  const calls=[];
  const client=imports.createBrowserQlooClient;
  imports.createBrowserQlooClient=options=>client({...options,fetchImpl:async(_,init)=>{
    const call={body:JSON.parse(init.body),signal:init.signal};calls.push(call);return transport(call);
  }});
  const members=[{name:'Alex',preferences:['Dune','','']},{name:'Sam',preferences:['','','']}];
  const trip={city:'New York',time:'18:00-22:00',budget:'200'};
  const nodes=new Map();
  const document={documentElement:{},querySelectorAll:()=>[],querySelector(selector){
    if(!nodes.has(selector)) nodes.set(selector,{innerHTML:'',listeners:{},querySelectorAll:()=>[],querySelector:()=>null,
      addEventListener(type,handler){this.listeners[type]=handler;}});
    return nodes.get(selector);
  }};
  const form=document.querySelector('#members-workspace');
  form.querySelector=selector=>({value:trip[selector.match(/data-context="([^"]+)"/)?.[1]]||''});
  form.querySelectorAll=selector=>selector!=='.member-card'?[]:members.map(member=>({
    querySelector:selector=>({value:member[selector.match(/data-field="([^"]+)"/)?.[1]]||''}),
    querySelectorAll:selector=>selector==='.member-preference'?member.preferences.map(value=>({value})):[],
  }));
  const context=vm.createContext({...imports,document,URLSearchParams,AbortController,setTimeout,clearTimeout,
    window:{addEventListener(){},setTimeout,matchMedia:()=>({matches:true})},location:{hash:'',search:''}});
  vm.runInContext(source.replace(/^import .*;\r?$/gm,''),context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {calls,members,flush,
    submit:()=>form.listeners.submit({preventDefault(){}}),
    edit(){form.listeners.input({target:{}});},
    choose(value){document.querySelector('#entity-confirmation-form').listeners.change({target:{matches:()=>true,dataset:{choiceKey:'0:0'},value}});},
    compare:()=>document.querySelector('#entity-confirmation-form').listeners.submit({preventDefault(){}}),
    cancel(){document.querySelector('#cancel-members').listeners.click();},
    language(value){document.querySelector('#language-switch').listeners.change({target:{value}});},
    select(id){document.querySelector('#members-result').listeners.click({target:{closest:()=>({dataset:{candidateId:id,version:String(this.state.version)}})}});},
    review(type,data={}){document.querySelector('#members-route-panel').listeners.click({target:{closest:()=>({dataset:{review:type,version:String(this.state.version),...data}})}});},
    get summary(){return document.querySelector('#members-result').innerHTML;},
    get route(){return document.querySelector('#members-route').innerHTML;},
    get state(){return vm.runInContext('membersNegotiationState',context);},
    get request(){return vm.runInContext('activeMembersRequest',context);},
    get choices(){return vm.runInContext('entityChoices',context);},
  };
}
const search={mode:'common-search',source:'live',members:[{id:'m1',name:'Alex',preferences:[{kind:'movie',query:'Dune',matches:[{id:'dune-1984',name:'Dune',year:1984,types:['urn:entity:movie']},{id:'dune-2021',name:'Dune',year:2021,types:['urn:entity:movie']}]}]},{id:'m2',name:'Sam',preferences:[]}]};
const comparison={mode:'common-compare',source:'live',members:[{id:'m1',name:'Alex',entities:[{id:'dune-2021',kind:'movie'}]},{id:'m2',name:'Sam',entities:[]}],pool:[{id:'place',name:'Synthetic place',sourceTag:'mock:fixture'}],rankings:[{memberId:'m1',entities:[{id:'place',query:{affinity:.9,explainability:{}}}]}]};
const response=insight=>({ok:true,json:async()=>({ok:true,insight})});
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};};
test('optional preference flow requires explicit entity confirmation before comparison and candidate selection',async()=>{
  const ui=await mount(call=>response(call.body.mode==='common-search'?search:comparison));
  await ui.submit();
  assert.equal(ui.calls.length,1,'one preference is sufficient to search');
  assert.equal(ui.calls[0].body.mode,'common-search');
  assert.deepEqual(ui.calls[0].body.members[1].preferences,[]);
  await ui.compare();assert.equal(ui.calls.length,1,'unconfirmed ambiguity cannot compare');
  ui.choose('dune-2021');ui.language('zh');
  assert.equal(ui.choices['0:0'],'dune-2021');assert.equal(ui.calls.length,1);
  await ui.compare();assert.equal(ui.calls.length,2);
  assert.equal(ui.calls[1].body.members[0].entities[0].id,'dune-2021');
  assert.equal(ui.state.selected.length,0,'no place is automatically adopted');
  ui.select('place');
  assert.equal(ui.state.selected.length,0);assert.equal(ui.state.pending.selected[0].id,'place');
  assert.match(ui.route,/替代的成员排名/);assert.doesNotMatch(ui.route,/NaN/);
});
test('editing during comparison invalidates late results without restoring an old candidate state',async()=>{
  const wait=deferred();
  const ui=await mount(call=>call.body.mode==='common-search'?response(search):wait.promise);
  await ui.submit();assert.equal(ui.calls.length,1);
  ui.choose('dune-2021');const pending=ui.compare();await ui.flush();
  ui.members[0].preferences[0]='A different movie';ui.edit();
  assert.equal(ui.calls[1].signal.aborted,true);
  wait.resolve(response(comparison));await pending;
  assert.equal(ui.state,null);assert.match(ui.summary,/Inputs changed/);
});
test('repeated search and cancelled comparison ignore obsolete responses',async()=>{
  const first=deferred();const compare=deferred();let count=0;
  const ui=await mount(call=>call.body.mode==='common-compare'?compare.promise:++count===1?first.promise:response(search));
  const old=ui.submit();await ui.flush();await ui.submit();
  first.resolve(response({...search,members:[]}));await old;
  assert.match(ui.summary,/Dune/);
  ui.choose('dune-2021');const pending=ui.compare();await ui.flush();ui.cancel();
  compare.resolve(response(comparison));await pending;
  assert.equal(ui.state,null);assert.match(ui.summary,/Query cancelled/);
});
test('editing an adopted route preserves places but disables decisions against the old trip inputs',async()=>{
  const ui=await mount(call=>response(call.body.mode==='common-search'?search:comparison));
  await ui.submit();ui.choose('dune-2021');await ui.compare();ui.select('place');ui.review('confirm');
  const before=JSON.stringify(ui.state);
  ui.members[0].hardRejections='Synthetic place';ui.edit();
  assert.match(ui.route,/Inputs changed/);assert.match(ui.route,/disabled[^>]*data-review|data-review[^>]*disabled/);
  for(const type of ['confirm','confirm_site','reject','retry']) ui.review(type,{candidateId:'place'});
  await ui.flush();
  assert.equal(JSON.stringify(ui.state),before);
  assert.equal(ui.calls.length,2);
  assert.equal(ui.state.selected[0].id,'place');
});
test('undo after a fresh common pool restores the matching comparison evidence and selection choices',async()=>{
  const old={...comparison,evidenceKind:'synthetic',members:comparison.members.slice(0,1)};
  const fresh={...old,pool:[{id:'refill',name:'Synthetic refill',sourceTag:'mock:fixture'}],rankings:[{memberId:'m1',entities:[{id:'refill',query:{affinity:.8}}]}]};
  let compares=0;
  const ui=await mount(call=>response(call.body.mode==='common-search'?search:++compares===1?old:fresh));
  ui.members.splice(1);
  await ui.submit();ui.choose('dune-2021');await ui.compare();ui.select('place');ui.review('confirm');
  ui.review('reject',{candidateId:'place'});await ui.flush();await ui.flush();
  assert.match(ui.summary,/Synthetic refill/);assert.equal(ui.calls.length,3);
  ui.review('undo');
  assert.doesNotMatch(ui.summary,/Synthetic refill/);assert.match(ui.summary,/Synthetic place/);
  assert.match(ui.summary,/Synthetic test data/);
  assert.deepEqual(Array.from(ui.state.candidates,item=>item.id),['place']);
  assert.equal(ui.state.selected[0].id,'place');
});
test('hard exclusions also remove hidden places from the selectable common Top 5 count',async()=>{
  const ranked={...comparison,members:comparison.members.slice(0,1),pool:[...comparison.pool,{id:'other',name:'Other place'}],rankings:[{memberId:'m1',entities:[{id:'place'},{id:'other'}]}]};
  const ui=await mount(call=>response(call.body.mode==='common-search'?search:ranked));
  ui.members.splice(1);ui.members[0].hardRejections='Synthetic place';
  await ui.submit();ui.choose('dune-2021');await ui.compare();
  assert.match(ui.summary,/1 candidates appear in the common Top 5/);
  assert.doesNotMatch(ui.summary,/data-candidate-id="place"/);
});
