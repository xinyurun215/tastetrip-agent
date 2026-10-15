import assert from 'node:assert/strict';
import test from 'node:test';
import {createTravelBook, createAlbumPages, renderTravelBook} from '../src/travelBook.js';
import {SAMPLE_ALBUMS} from '../src/travelBookSamples.js';
import {existsSync} from 'node:fs';

test('the book preserves selected order, missing costs and input immutability',()=>{
 const input={route:{stops:[{id:'b',name:'乙站',cost:0},{id:'a',name:'甲站'}]},candidates:[{id:'a',cost:12},{id:'b'},{id:'rejected'}],source:'fallback'};
 const original=structuredClone(input),book=createTravelBook(input);
 assert.deepEqual(book.stops.map(s=>s.name),['乙站','甲站']);
 assert.equal(book.stops[0].cost,'');assert.equal(book.stops[1].cost,'12');assert.deepEqual(input,original);
});
test('unknown values stay unknown and explicit zero remains zero',()=>{
 const book=createTravelBook({route:{stops:[{id:'a',cost:0}]},candidates:[{id:'a',priceLevel:3}],source:'live'});
 assert.equal(book.demo,false);assert.equal(book.stops[0].cost,'');assert.equal(book.stops[0].photo,'');
 assert.equal(book.date,'');assert.deepEqual(book.members,[]);
 assert.equal(createTravelBook({route:{stops:[{cost:0}]}}).stops[0].cost,'0');
});
test('user text is escaped and unsafe photo URLs are rejected',()=>{
 const book=createTravelBook({route:{stops:[{name:'<img onerror="bad">',reason:'<script>bad</script>',imageUrl:'javascript:alert(1)'}]}});
 const pages=createAlbumPages({title:'<x>',sample:false,book}).join('');
 assert.doesNotMatch(pages,/<img onerror|<script>/);assert.match(pages,/&lt;script&gt;/);assert.equal(book.stops[0].photo,'');
 assert.match(pages,/尚未全员确认/);assert.match(pages,/当前行程没有旅行照片/);
});
test('safe source photography keeps attribution',()=>{
 const book=createTravelBook({route:{stops:[{name:'街景',image:{url:'https://example.com/p.jpg',sourceUrl:'https://example.com/credit',credit:'摄影者'}}]}});
 const pages=createAlbumPages({title:'旅途',sample:false,book}).join('');
 assert.match(pages,/https:\/\/example.com\/p.jpg/);assert.match(pages,/https:\/\/example.com\/credit/);assert.match(pages,/摄影者/);
});
test('sample albums have real bundled photographs, credits, honest labels and complete pairs of page faces',()=>{
 for(const album of SAMPLE_ALBUMS){
  const pages=createAlbumPages(album);
  assert.equal(pages.length%2,1);
  assert.match(pages.join(''),/非你的旅行记录/);assert.match(pages.join(''),/Unsplash License/);
  for(const p of album.photos){assert.ok(existsSync(new URL('../public'+p.src,import.meta.url)));assert.ok(p.credit);assert.ok(p.source.startsWith('https://unsplash.com/photos/'));}
 }
});
test('library remains distinct from the three-step process and offers samples even with no selected stops',()=>{
 const html=renderTravelBook(createTravelBook({route:{stops:[]},source:'live'}));
 assert.match(html,/data-album="0"/);assert.match(html,/返回行程/);assert.match(html,/行程草稿/);assert.match(html,/尚未全员确认/);
 assert.doesNotMatch(html,/book-index|data-shell-nav|全员已确认/);
 for(const n of [0,1,2,3]) assert.equal(createAlbumPages({title:'行程',sample:false,book:createTravelBook({route:{stops:Array.from({length:n},()=>({name:'站点'}))}})}).length%2,1);
});
