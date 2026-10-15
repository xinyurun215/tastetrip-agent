import assert from "node:assert/strict";
import test from "node:test";
import { createTravelBook, renderBookPage, renderTravelBook } from "../src/travelBook.js";

test("the book preserves the selected order and never revives rejected or unplanned candidates", () => {
  const input = { route: { stops: [{ id: "b", name: "乙站", time: "18:00", cost: 0 }, { id: "a", name: "甲站" }] }, candidates: [{ id: "a", cost: 12 }, { id: "b" }, { id: "rejected" }], source: "fallback" };
  const original = structuredClone(input);
  const book = createTravelBook(input);
  assert.deepEqual(book.stops.map((s) => s.name), ["乙站", "甲站"]);
  assert.equal(book.stops[0].cost, "");
  assert.equal(book.stops[1].cost, "12");
  assert.match(renderBookPage(book, 1), /费用待补充/);
  assert.deepEqual(input, original);
});

test("missing dates, names, photos, reasons and amounts remain unknown; zero is only shown if supplied", () => {
  const book = createTravelBook({ route: { stops: [{ id: "a", name: "甲站", cost: 0 }] }, candidates: [{ id: "a", priceLevel: 3 }], source: "live" });
  assert.equal(book.demo, false);
  assert.match(renderBookPage(book, 0), /日期待补充/);
  assert.match(renderBookPage(book, 0), /同行者待补充/);
  assert.match(renderBookPage(book, 1), /此站暂无来源照片/);
  assert.match(renderBookPage(book, 1), /尚无选点说明/);
  const zero = createTravelBook({ route: { stops: [{ cost: 0 }] } });
  assert.match(renderBookPage(zero, 1), /0（币种未提供）/);
});

test("real explanations and photo attribution are copied and escaped, unsafe URLs are rejected", () => {
  const book = createTravelBook({ route: { stops: [{ name: '<img onerror="bad">', reason: "已有依据", image: { url: "https://example.com/photo.jpg", sourceUrl: "https://example.com/credit", credit: "摄影者" } }] } });
  const html = renderBookPage(book, 1);
  assert.match(html, /已有依据/);
  assert.match(html, /https:\/\/example.com\/photo.jpg/);
  assert.match(html, /https:\/\/example.com\/credit/);
  assert.match(html, /摄影者/);
  assert.doesNotMatch(html, /<img onerror/);
  const unsafe = createTravelBook({ route: { stops: [{ imageUrl: 'javascript:alert(1)' }] } });
  assert.equal(unsafe.stops[0].photo, "");
});

test("all sources stay drafts and fallback is explicitly labelled even if route says achieved", () => {
  for (const source of ["live", "fallback", "mock"]) {
    const book = createTravelBook({ route: { status: "achieved", stops: [] }, source });
    assert.match(renderTravelBook(book), /行程草稿/);
    assert.match(renderTravelBook(book), /尚未全员确认/);
    assert.match(renderBookPage(book, 0), /暂无已选站点/);
    assert.equal(renderBookPage(book, 0).includes("演示 / 备用数据"), source !== "live");
  }
});
