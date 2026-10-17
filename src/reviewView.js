import { t, messageFor, unknownLabel } from './i18n.js';

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const label = value => esc(t(value));
const names = (state, list) => list.map(id => esc(state.candidates.find(item => item.id === id)?.name || state.base.find(item => item.id === id)?.name || state.rejectedNames?.[id] || id)).join(' · ') || label('尚无');
const time = value => value || t('待核实');
function source(result) {
  if (result.evidenceKind === 'synthetic' || result.source === 'synthetic') return t('合成测试数据；不是 Qloo 实测。');
  return result.source === 'live' ? `${t('Qloo 真实口味证据')}${result.cached ? ` · ${t('缓存')}` : ''}`
    : result.source === 'unavailable' ? `${messageFor(result.reason)} · ${t('无可用路线')}` : t('备用数据 · 非真实 Qloo 结果');
}
const sourceLabel = value => ['qloo:entity','live'].includes(value) ? t('Qloo 真实口味证据')
  : ['mock:fixture','synthetic','mock'].includes(value) ? t('合成测试数据；不是 Qloo 实测。') : '';
const statusLabel = route => t(route.status === 'verified' ? '约束已验证' : route.status === 'blocked' ? '已停止' : '待核实');
const action = (state, type, text, extra = '') => `<button type="button" class="ghost" data-review="${type}" data-version="${state.version}" ${state.inputStale ? 'disabled' : ''} ${extra}>${esc(text)}</button>`;
function memberValue(item, member) {
  if (item.memberRanks) return Number.isFinite(item.memberRanks[member.id]) ? `#${item.memberRanks[member.id]}` : '—';
  const score = item.memberScores?.[member.id] ?? item.scores?.[member.id];
  return Number.isFinite(score) ? score.toFixed(2) : '—';
}

export function renderReviewEvidence(result, fairness) {
  const members = result.members || [];
  const entities = members.map(member => `<article class="member-entity"><h3>${esc(member.name)} <span class="tag">${esc(member.sourceTag || (result.source === 'live' ? 'qloo:entity' : 'mock:fixture'))}</span></h3><p>${(member.entities || []).map(entity => esc(entity.name)).join(' · ') || '—'}</p></article>`).join('');
  const matrix = fairness.scoreMatrix.length ? `<div class="matrix-scroll"><table class="score-matrix"><thead><tr><th>${label('实体')}</th>${members.map(member => `<th>${esc(member.name)}</th>`).join('')}<th>${label('群体分')}</th><th>${label('来源')}</th></tr></thead><tbody>${fairness.scoreMatrix.map(row => `<tr><th>${esc(row.candidateName)}</th>${members.map(member => `<td>${typeof row.scores[member.id] === 'number' ? row.scores[member.id].toFixed(2) : '—'}</td>`).join('')}<td>${row.scoreCoverage === 1 && row.groupScore != null ? row.groupScore.toFixed(2) : '—'}</td><td>${esc(row.sourceTag)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty-note">${label('暂无评分。缺失亲和度显示为 —，不会补造。')}</p>`;
  return `<section class="members-result reveal" id="members-result-panel"><div class="result-heading"><div><p class="seam-kicker">02 · Qloo</p><h2>${label('成员实体与公平线索')}</h2></div><p class="source-note">${esc(source(result))}</p></div>${result.reason ? `<p class="review-notice" role="status">${esc(messageFor(result.reason))}</p>` : ""}<div class="member-entities">${entities}</div><h3>${label('评分矩阵')}</h3>${matrix}<p class="review-explanation">${label('共同得分 = 平均值 + 最低值 − 最大差值；仅用完整成员评分挑选替代。')}</p><p>${esc(t('硬拒绝已过滤 {n} 项', {n:fairness.filtered.length}))}</p><button type="button" class="play shell-next" data-shell-next="negotiation">${label('查看路线与修改 →')}</button> <button type="button" class="ghost" data-shell-next="members">${label('返回成员输入')}</button></section>`;
}

function renderDiff(state) {
  const { pending } = state;
  if (!pending) return '';
  const { diff } = pending;
  const row = (id) => {
    const before = diff.before.stops.find(item => item.id === id);
    const after = diff.after.stops.find(item => item.id === id);
    const leg = route => {
      const index = route.stops.findIndex(item => item.id === id);
      return index < 0 ? '—' : `${index ? route.stops[index - 1].name : t('起点')} → ${route.stops[index].name}`;
    };
    const cell = (stop, route) => stop ? `${esc(leg(route))}<br>${esc(time(stop.time))} · ${esc(t('移动 {value}', { value: stop.moveMinutes == null ? t('待核实') : `${stop.moveMinutes} ${t('分钟')}` }))}` : '—';
    return `<tr><th>${names(state, [id])}</th><td>${cell(before, diff.before)}</td><td>${cell(after, diff.after)}</td></tr>`;
  };
  return `<section class="review-diff" aria-labelledby="diff-title"><p class="seam-kicker">${esc(t('版本 {n}', {n:pending.version}))}</p><h3 id="diff-title">${label('待确认修改')}</h3><dl><dt>${label('移除')}</dt><dd>${names(state,diff.removed)}</dd><dt>${label('替代')}</dt><dd>${names(state,diff.added)}</dd><dt>${label('保留确认')}</dt><dd>${names(state,diff.retained)}</dd></dl><h4>${label(state.comparisonMode ? '替代的成员排名' : '替代的成员亲和度')}</h4>${pending.selected.filter(item=>diff.added.includes(item.id)).map(item=>`<p>${esc(item.name)} · ${state.members.map(member=>`${esc(member.name || member.id)} ${memberValue(item, member)}`).join(' / ')} · ${esc(sourceLabel(item.sourceTag))}</p>`).join('')}<h4>${label('受影响路段与下游时间')}</h4><div class="matrix-scroll"><table class="score-matrix"><thead><tr><th>${label('实体')}</th><th>${label('原方案')}</th><th>${label('拟议方案')}</th></tr></thead><tbody>${[...new Set([...diff.removed,...diff.affected])].map(row).join('')}</tbody></table></div><p>${label(pending.queried ? '补查来源：Qloo 实际响应' : '替代来源：已有候选池，未额外查询')}</p><p>${esc(statusLabel(pending.route))} · ${esc((pending.route.unknownFields || []).map(unknownLabel).join(' · '))}</p><div class="negotiation-actions">${action(state,'confirm',t('采纳此版本修改'))}${action(state,'cancel',t('取消修改'))}</div><p>${label('取消后保留排除项，不会自动恢复被否决站点。')}</p></section>`;
}

export function renderReviewRoute(result, request, state, route, {inputStale = false} = {}) {
  state = {...state,inputStale};
  const list = route.stops.map((stop, index) => `<li><span class="route-index">${String(index+1).padStart(2,'0')}</span><div><b>${esc(stop.name)}</b>${stop.address ? `<small>${esc(stop.address)}</small>` : ""}<small>${esc(time(stop.time))} · ${esc(statusLabel({status:stop.status}))}</small><small>${esc((stop.unknownFields || []).map(unknownLabel).join(' · '))}</small><span class="tag">${label(state.confirmedIds.includes(stop.id) ? '已确认站点' : '尚未确认')}</span><div class="negotiation-actions">${action(state,'reject',t('否决'),`data-candidate-id="${esc(stop.id)}"`)}${!state.confirmedIds.includes(stop.id) && !state.pending && !['checking','cancelled','blocked'].includes(state.phase) ? action(state,'confirm_site',t('确认此站'),`data-candidate-id="${esc(stop.id)}"`) : ''}</div></div><em>${esc(sourceLabel(stop.sourceTag))}</em></li>`).join('');
  return `<section class="members-route reveal" id="members-route-panel"><div class="route-heading"><div><p class="seam-kicker">03 · ${esc(t('版本 {n}',{n:state.version}))}</p><h2>${label('审阅路线草案')}</h2></div><p class="source-note">${esc(source(result))}</p></div><p>${esc(request.context?.city)} · ${esc(request.context?.start)} · ${esc(request.context?.time)}</p><p class="review-explanation">${label('由当前操作者确认站点选择，不代表每位成员实名同意，也不证明行程可执行。')}</p>${inputStale ? `<p class="review-notice" role="status">${esc(messageFor('input_changed'))}</p>` : ''}<p class="review-status" role="status">${esc(route.reasonCode === 'no_common_time' ? messageFor('no_common_time') : statusLabel(route))}${state.confirmedVersion === state.version ? ` · ${label('站点选择已由当前操作者确认。')}` : ''}</p><h3>${label('当前采纳的站点')}</h3><ol class="members-route-list">${list || `<li class="route-empty">${label(state.comparisonMode && !state.rejectedIds.length ? '待选择候选；请返回共同候选比较。' : '暂无可采纳站点。请修改条件或撤销否决。')}</li>`}</ol><p>${label('已排除')}：${names(state,state.rejectedIds)}</p>${state.phase === 'checking' ? `<p role="status">${label('正在补查 Qloo，已确认站点保持不变…')}</p>${action(state,'cancel',t('取消查询'))}` : ''}${state.notice ? `<p class="review-notice" role="status">${esc(messageFor(state.notice))}</p>` : ''}${state.comparisonMode && state.selected.some(item => !(result.pool || []).some(place => place.id === item.id || item.aliasIds?.includes(place.id))) ? `<p>${label('这些站点沿用此前候选池的证据；不与当前池的排名混合比较。')}</p>` : ''}${renderDiff(state)}<div class="negotiation-actions">${!state.pending && ['draft','confirmed'].includes(state.phase) && state.selected.length ? action(state,'confirm',t('确认当前站点选择')) : ''}${state.history.length ? action(state,'undo',t('撤销上次决定')) : ''}${['blocked','cancelled'].includes(state.phase) && state.rejectedIds.length ? action(state,'retry',t('重新查找替代')) : ''}</div><button type="button" class="ghost" data-shell-next="qloo">${label('返回 Qloo 结果')}</button></section>`;
}
