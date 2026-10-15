const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const text = (value) => typeof value === "string" ? value.trim() : "";

function webUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

// A read-only view of the chosen route: never select, reorder or infer consensus.
export function createTravelBook({ route, context = {}, members = [], candidates, source }) {
  return {
    destination: text(context.city) || text(context.destination),
    date: text(context.date),
    time: text(context.time),
    members: members.map((member) => text(member.name)).filter(Boolean),
    budget: present(context.budget) ? String(context.budget) : "",
    demo: source !== "live",
    stops: (route?.stops || []).map((stop) => {
      const raw = candidates
        ? candidates.find((candidate) => String(candidate.id ?? candidate.candidateId) === String(stop.candidateId ?? stop.id)) || {}
        : stop;
      // The planner defaults missing cost to zero. Read the original candidate instead.
      const cost = raw.cost ?? raw.estimatedCost ?? raw.price;
      const amount = present(cost) && Number.isFinite(Number(cost)) && Number(cost) >= 0 ? String(cost) : "";
      const photo = webUrl(raw.image?.url || raw.imageUrl || raw.photo?.url);
      return {
        name: text(stop.name), time: text(stop.time), cost: amount,
        currency: text(raw.currency),
        reason: text(stop.reason) || text(stop.whyBoth),
        detail: text(stop.detail),
        source: text(stop.sourceTag) || (source === "live" ? "qloo:entity" : "mock:fixture"),
        photo, photoSource: webUrl(raw.image?.sourceUrl || raw.photo?.sourceUrl) || photo,
        photoCredit: text(raw.image?.credit || raw.photo?.credit),
      };
    }),
  };
}

// The library is separate from the planning flow. Only its own DOM is changed.
import { SAMPLE_ALBUMS } from './travelBookSamples.js';

const photo = (p, caption = '') => `<figure class="album-photo"><img src="${esc(p.src)}" alt="${esc(p.alt)}" draggable="false"><figcaption>${esc(caption || p.alt)}</figcaption></figure>`;
const prose = (title, copy, kicker = '') => `<div class="album-prose"><span>${esc(kicker)}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;

export function createAlbumPages(album) {
  if (album.sample) {
    return [
      prose(album.title, '翻过一页，再走一次。', '摄影示例 · 非你的旅行记录'),
      photo(album.photos[0]),
      album.photos[1] ? photo(album.photos[1]) : prose(album.chapter, album.story, '示例文字'),
      photo(album.photos[2] || album.photos[0]),
      prose(album.chapter, album.story, '示例文字'),
      photo(album.photos[3] || album.photos[0], '把这一刻，留在纸上。'),
      `<div class="album-prose album-credits"><span>摄影与许可</span><h3>谢谢记录的人</h3>${album.photos.map(p => `<p><a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">${esc(p.credit)} ↗</a></p>`).join('')}<p><a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">Unsplash License ↗</a></p><p>授权摄影与示例文字，只供体验；不代表你已到访，也不代表同行者已确认。</p></div>`,
    ];
  }
  const pages = [prose(album.title, '行程是章节的起点。照片和故事，等你带回来。', '行程草稿 · 尚未全员确认')];
  album.book.stops.forEach((stop, i) => {
    pages.push(prose(stop.name || '地点待补充', stop.reason || '这段旅途的故事，留待你来写。', `第 ${i + 1} 站 · ${stop.time || '时间待补充'}`));
    pages.push(stop.photo ? `<figure class="album-photo"><img src="${esc(stop.photo)}" alt="${esc(stop.name)}的来源照片" draggable="false"><figcaption><a href="${esc(stop.photoSource)}" target="_blank" rel="noopener noreferrer">${esc(stop.photoCredit || '照片来源')} ↗</a></figcaption></figure>` : prose('这一页，等一张照片', '当前行程没有旅行照片。先去书架翻阅摄影示例册，体验完成后的样子。', '尚未添加照片'));
  });
  if (pages.length === 1) pages.push(prose('旅途还未开始', '返回协商路线，选定站点后再来。', '暂无已选站点'));
  if (pages.length % 2 === 0) pages.push(prose('未完，待续', '计划不等于到访。这本行程册尚未全员确认。'));
  return pages;
}

function albumsFor(book) {
  return [...SAMPLE_ALBUMS, { title: book.destination || '我们的旅途', subtitle: '行程草稿', sample: false, book, photos: [], chapter: '', story: '' }];
}

function cover(album) {
  return `${album.sample ? `<img src="${esc(album.photos[0].src)}" alt="${esc(album.photos[0].alt)}" draggable="false">` : ''}<div class="album-cover-lettering"><small>${album.sample ? '摄影示例' : '行程草稿'}</small><h2>${esc(album.title)}</h2><p>${esc(album.subtitle)}</p><span>合味旅行</span></div>`;
}

export function renderTravelBook(book) {
  const albums = albumsFor(book);
  return `<dialog class="travel-book" aria-label="合味旅行回忆画册">
    <header class="album-toolbar"><div><h2>旅行回忆画册</h2><p>TASTETRIP · 合味旅行</p></div><button type="button" data-book-close>返回行程 ↗</button></header>
    <div class="album-library" data-library>
      <div class="album-shelf" aria-label="选择一本画册">${albums.map((a,i) => `<div class="album-slot"><button type="button" class="album-spine" data-album="${i}" aria-label="抽出${esc(a.title)}${a.sample ? '摄影示例册' : '行程草稿'}" style="--spine-height:${[232,250,223,240,228,246][i % 6]}px;${a.photos[0] ? `--spine-image:url('${esc(a.photos[0].src)}')` : ''}"><span class="spine-side" aria-hidden="true"></span><span class="spine-title">${esc(a.title)}</span><span class="spine-edition">${a.sample ? '示例' : '草稿'}</span><span class="spine-edge" aria-hidden="true"></span></button></div>`).join('')}</div>
      <div class="album-library-caption"><p>把走过的路，收成一本书。</p><span>选一本，慢慢翻。</span></div>
    </div>
    <div class="album-reader" data-reader hidden><div class="album-stage" data-stage></div><nav class="album-controls" aria-label="画册阅读操作"><button type="button" data-prev>← 上一页</button><span role="status" aria-live="polite" data-position></span><button type="button" data-next>展开画册 →</button></nav><div class="album-return"><button type="button" data-shelve>放回书架</button><span data-album-notice></span></div></div>
    <footer class="album-footer"><span>摄影示例并非你的旅行记录 · 行程尚未全员确认 · 仅阅读，不上传或保存照片</span><span>左右滑动 / ← → 翻页 · Esc 返回</span></footer>
  </dialog>`;
}

export function openTravelBook(book, trigger, onReturn) {
  document.querySelector('.travel-book')?.close();
  document.body.insertAdjacentHTML('beforeend', renderTravelBook(book));
  const dialog = document.querySelector('.travel-book');
  const library = dialog.querySelector('[data-library]');
  const reader = dialog.querySelector('[data-reader]');
  const stage = dialog.querySelector('[data-stage]');
  const prev = dialog.querySelector('[data-prev]');
  const next = dialog.querySelector('[data-next]');
  const status = dialog.querySelector('[data-position]');
  const shelve = dialog.querySelector('[data-shelve]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const albums = albumsFor(book);
  let selected = null, turn = 0, busy = false, epoch = 0, origin, sourceRect;
  const animations = new Set();
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  async function animate(el, frames, duration) {
    if (reduced.matches || !dialog.open) return;
    const motion = el.animate(frames, { duration, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'none' });
    animations.add(motion);
    await motion.finished.catch(() => {});
    animations.delete(motion);
  }
  const leaves = () => [...stage.querySelectorAll('.album-leaf')];
  function paint() {
    const all = leaves();
    stage.querySelector('.album-object')?.classList.toggle('is-open', turn > 0);
    all.forEach((leaf, i) => {
      leaf.style.transform = `translateZ(${(i < turn ? i + 1 : all.length - i) * .6}px) rotateY(${i < turn ? -180 : 0}deg)`;
      leaf.style.zIndex = i < turn ? i + 1 : all.length - i + 1;
      const front = leaf.querySelector('.leaf-front');
      const back = leaf.querySelector('.leaf-back');
      front.inert = i !== turn;
      back.inert = i !== turn - 1;
      front.setAttribute('aria-hidden', String(i !== turn));
      back.setAttribute('aria-hidden', String(i !== turn - 1));
    });
    prev.disabled = turn === 0;
    prev.setAttribute("aria-disabled", String(busy || turn === 0));
    next.disabled = turn === all.length;
    next.setAttribute("aria-disabled", String(busy || turn === all.length));
    shelve.disabled = busy;
    next.textContent = turn === 0 ? '展开画册 →' : '下一页 →';
    prev.textContent = turn === 1 ? '← 合上画册' : '← 上一页';
    status.textContent = turn ? `${String(turn).padStart(2,'0')} / ${String(all.length).padStart(2,'0')}` : `${selected.title} · 封面`;
    stage.dataset.turn = String(turn);
    stage.setAttribute('aria-busy', String(busy));
  }
  async function select(index, button) {
    if (busy || selected) return;
    selected = albums[index]; origin = button; turn = 0; busy = true;
    const source = button.getBoundingClientRect(); sourceRect = source;
    const pages = createAlbumPages(selected);
    stage.innerHTML = `<div class="album-object ${selected.sample ? "" : "is-itinerary"}"><div class="album-board"></div><div class="album-page-block"></div><div class="album-endpaper">${prose('合味旅行', '把每一次同行，留在纸上。')}</div><div class="album-binding"></div><div class="album-leaf album-hardcover"><div class="leaf-face leaf-front album-cover">${cover(selected)}</div><div class="leaf-face leaf-back">${pages[0]}</div></div>${Array.from({length: (pages.length - 1) / 2}, (_, i) => `<div class="album-leaf"><div class="leaf-face leaf-front">${pages[i*2+1]}<span class="album-page-number">${i*2+1}</span></div><div class="leaf-face leaf-back">${pages[i*2+2]}<span class="album-page-number">${i*2+2}</span></div></div>`).join('')}</div>`;
    library.hidden = true; reader.hidden = false;
    dialog.querySelector('[data-album-notice]').textContent = selected.sample ? '摄影示例 · 照片出处与许可见末页' : '行程草稿 · 未添加照片 · 尚未全员确认';
    paint();
    const object = stage.querySelector('.album-object');
    const target = object.getBoundingClientRect();
    const dx = source.left + source.width / 2 - target.left - target.width / 2;
    const dy = source.top + source.height / 2 - target.top - target.height / 2;
    await animate(object, [{transform:`translateX(-50%) translate(${dx}px,${dy}px) scale(.56) rotateY(-82deg)`},{transform:'translateX(-50%) translate(0,0) scale(1) rotateY(-12deg)'}], 780);
    if (!dialog.open) return;
    busy = false; paint(); next.focus({preventScroll:true});
  }
  async function flip(direction) {
    const all = leaves();
    if (busy || !selected || turn + direction < 0 || turn + direction > all.length) return;
    busy = true; const revision = ++epoch;
    const i = direction > 0 ? turn : turn - 1;
    const leaf = all[i];
    const object = stage.querySelector('.album-object');
    const from = direction > 0 ? 0 : -180, to = direction > 0 ? -180 : 0;
    if (i === 0 && direction > 0) object.classList.add('is-open');
    paint();
    if (i === 0 && direction > 0) object.classList.add('is-open');
    leaf.style.zIndex = 100;
    const shade = leaf.querySelectorAll('.leaf-face');
    shade.forEach(face => face.classList.add('is-turning'));
    await animate(leaf, [{transform:`translateZ(8px) rotateY(${from}deg)`},{transform:`translateZ(8px) rotateY(${(from+to)/2}deg) rotateX(2deg)`,offset:.5},{transform:`translateZ(8px) rotateY(${to}deg)`}], 850);
    if (revision !== epoch || !dialog.open) return;
    shade.forEach(face => face.classList.remove('is-turning'));
    turn += direction; busy = false; paint();
    if (!dialog.contains(document.activeElement)) (next.disabled ? prev : next).focus({preventScroll:true});
  }
  async function putBack() {
    if (busy || !selected) return;
    busy = true; paint();
    const object = stage.querySelector('.album-object');
    // Close every leaf around the same spine; never replace the visible spread mid-turn.
    await Promise.all(leaves().filter((_,i) => i < turn).map(leaf => animate(leaf,[{transform:'translateZ(8px) rotateY(-180deg)'},{transform:'translateZ(8px) rotateY(0deg)'}],600)));
    turn = 0; paint();
    const target = object.getBoundingClientRect();
    const dx=sourceRect.left+sourceRect.width/2-target.left-target.width/2;
    const dy=sourceRect.top+sourceRect.height/2-target.top-target.height/2;
    await animate(object,[{transform:'translateX(-50%) rotateY(-12deg)'},{transform:`translateX(-50%) translate(${dx}px,${dy}px) scale(.56) rotateY(-82deg)`}],650);
    if (!dialog.open) return;
    reader.hidden = true; library.hidden = false; stage.innerHTML = '';
    selected = null; busy = false; origin?.focus({preventScroll:true});
  }
  dialog.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-album')) select(Number(button.dataset.album),button);
    if (button.hasAttribute('data-next')) flip(1);
    if (button.hasAttribute('data-prev')) flip(-1);
    if (button.hasAttribute('data-shelve')) putBack();
    if (button.hasAttribute('data-book-close')) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (selected && ['ArrowRight','ArrowLeft'].includes(event.key)) { event.preventDefault(); flip(event.key === 'ArrowRight' ? 1 : -1); }
  });
  let suppressSwipeClick = false;
  stage.addEventListener('click', event => {
    if (suppressSwipeClick) { suppressSwipeClick = false; return; }
    if (event.target.closest('a,button') || busy || !selected) return;
    const rect = stage.getBoundingClientRect();
    flip(turn === 0 || event.clientX > rect.left + rect.width / 2 ? 1 : -1);
  });
  let pointer = null;
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || busy || event.target.closest('a,button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    suppressSwipeClick = false;
    pointer = {id:event.pointerId,x:event.clientX,y:event.clientY};
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx=event.clientX-pointer.x, dy=event.clientY-pointer.y;
    pointer=null;
    if (Math.abs(dx)>35 && Math.abs(dx)>Math.abs(dy)*1.4) {
      suppressSwipeClick = true;
      flip(dx<0?1:-1);
    }
  });
  stage.addEventListener('pointercancel', () => {pointer=null;});
  stage.addEventListener('error', event => {
    if (event.target.tagName === 'IMG') { const image=event.target; const note=document.createElement('span'); note.className='album-image-error'; note.textContent='照片暂时无法加载'; image.replaceWith(note); }
  },true);
  const reduceChange = () => { if(reduced.matches) animations.forEach(a=>a.finish()); };
  reduced.addEventListener('change',reduceChange);
  dialog.addEventListener('close', () => {
    ++epoch; animations.forEach(a=>a.cancel()); reduced.removeEventListener('change',reduceChange);
    document.body.style.overflow=originalOverflow; dialog.remove(); trigger?.focus({preventScroll:true});
  }, {once:true});
  dialog.showModal(); dialog.querySelector('[data-album]')?.focus({preventScroll:true});
}
