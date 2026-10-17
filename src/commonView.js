import { t, messageFor, getLanguage } from './i18n.js';
import { sameCandidatePlace } from './pipeline/commonCandidates.js';
import { confirmedPreferenceName } from './explanationEvidence.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = value => esc(t(value));
const kinds = ['movie', 'artist', 'book'];
const kindLabel = kind => t({movie:'电影（可选）',artist:'音乐人（可选）',book:'书籍（可选）'}[kind] || kind);
const text = value => String(value ?? '').trim();
const fail = code => { throw Object.assign(new Error(code), {code}); };
const asList = value => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);

export function buildCommonSearchRequest(members, context = {}) {
  if (!members?.length) fail('EMPTY_MEMBERS');
  const seen = new Set();
  const normalized = members.map((member, index) => {
    const id = text(member.id) || `m${index + 1}`;
    if (seen.has(id)) fail('DUPLICATE_MEMBER');
    seen.add(id);
    const constraints = Object.fromEntries(['city','start','time','budget','hardRejections','softPreferences'].map(key => [key, text(member[key] ?? member.constraints?.[key])]));
    return { id, name:text(member.name) || t('成员 {n}', {n:index + 1}), constraints,
      hardRejections:constraints.hardRejections, softPreferences:constraints.softPreferences,
      preferences:(member.preferences || []).map((value, i) => ({kind:kinds[i],query:text(value)})).filter(item => item.query),
    };
  });
  if (!normalized.some(member => member.preferences.length)) fail('NO_CONFIRMED_SIGNALS');
  return {mode:'common-search',members:normalized,context:{...context}};
}

// This path accepts optional cultural signals. Legacy parseTastes requires all three older fields.
export function commonReviewInput(request) {
  const context = {...request.context,hardRejections:asList(request.context?.hardRejections)};
  const members = (request.members || []).map(member => {
    const constraints = {...member.constraints, ...member.context,
      hardRejections:asList(member.hardRejections ?? member.constraints?.hardRejections),
      softPreferences:asList(member.softPreferences ?? member.constraints?.softPreferences)};
    return {...member,context:constraints,constraints,hardRejections:constraints.hardRejections,softPreferences:constraints.softPreferences};
  });
  return {members,context};
}

export function buildConfirmedCommonRequest(search, request, choices) {
  const members = (request.members || []).map((member, mi) => {
    const found = search.members?.find(item => item.id === member.id);
    const entities = (member.preferences || []).flatMap((preference, pi) => {
      const choice = choices[`${mi}:${pi}`];
      if (!choice) fail('UNCONFIRMED_ENTITIES');
      if (choice === '__skip__') return [];
      const matches = found?.preferences?.find(item => item.kind === preference.kind && item.query === preference.query)?.matches || [];
      const entity = matches.find(item => String(item.id) === choice);
      if (!entity) fail('UNCONFIRMED_ENTITIES');
      return [{...entity,kind:preference.kind}];
    });
    return {...member,entities};
  });
  if (!members.some(member => member.entities.length)) fail('NO_CONFIRMED_SIGNALS');
  return {...request,mode:'common-compare',members};
}

function entityFacts(entity) {
  const isbn = asList(entity.isbn13).join(', ');
  return [entity.year,entity.disambiguation,isbn ? `ISBN ${isbn}` : ''].filter(Boolean).map(esc).join(' · ');
}

function entityTechnicalFacts(entity) {
  const facts = {id:entity.id,types:entity.types,external:entity.external ?? entity.properties?.external};
  return `<details class="technical-evidence"><summary>${label('技术详情')}</summary><pre>${esc(JSON.stringify(facts,null,2))}</pre></details>`;
}

export function renderEntityConfirmation(search, choices = {}) {
  const members = (search.members || []).map((member, mi) => `<article class="member-entity"><h3>${esc(member.name)}</h3>${(member.preferences || []).map((preference, pi) => {
    const key = `${mi}:${pi}`;
    const option = (value, content) => `<label class="entity-option"><input type="radio" data-entity-choice data-choice-key="${key}" name="entity-${mi}-${pi}" value="${esc(value)}" ${choices[key] === String(value) ? 'checked' : ''} /><span>${content}</span></label>`;
    return `<fieldset class="entity-choices"><legend>${esc(kindLabel(preference.kind))} · ${esc(preference.query)}</legend>${(preference.matches || []).map(entity => option(entity.id, `<b>${esc(entity.name)}</b><small>${entityFacts(entity)}</small>`) + entityTechnicalFacts(entity)).join('')}${!preference.matches?.length ? `<p>${label('未找到匹配实体；可以跳过或返回修改。')}</p>` : ''}${option('__skip__',label('跳过此偏好'))}</fieldset>`;
  }).join('') || `<p>${label('没有已确认偏好；此成员不参与排名。')}</p>`}</article>`).join('');
  return `<section class="members-result reveal"><div class="result-heading"><div><p class="seam-kicker">02 · Qloo</p><h2>${label('确认准确的文化实体')}</h2></div></div><p>${label('每条输入请选择一个准确实体或明确跳过；不会自动选中首条结果。')}</p><form id="entity-confirmation-form"><div class="member-entities">${members}</div><p id="entity-confirmation-error" class="review-notice" role="status"></p><button class="play" type="submit">${label('确认实体并比较共同候选')}</button> <button type="button" class="ghost" data-shell-next="members">${label('返回成员输入')}</button></form></section>`;
}

const technicalName = /qloo:entity|(?:urn|synthetic):|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const readable = (value, fallback) => text(value) && !technicalName.test(text(value)) ? text(value) : t(fallback);
const preferenceName = (member, id, name) => member.entities?.some(entity => entity.id === id)
  ? confirmedPreferenceName(member,id,getLanguage()) : readable(name,'某项已确认偏好');
const unavailableIds = (evidence, coverage) => [...new Set([...(coverage?.unavailableSignalIds || []), ...(evidence?.unavailableSignalIds || [])])];
function contributionNames(evidence, member, coverage) {
  if (evidence?.allSignalsUnavailable || coverage?.allSignalsUnavailable || coverage?.hasSignals === false) return [];
  const unavailable = unavailableIds(evidence,coverage);
  return [...new Set((evidence?.contributions || []).filter(item => !unavailable.includes(item.entityId)).map(item => preferenceName(member,item.entityId,item.name)))];
}
function evidenceText(evidence, member, coverage) {
  if (coverage?.hasSignals === false) return label('没有已确认偏好；此成员不参与排名。');
  const contributions = contributionNames(evidence,member,coverage).map(esc).join(' · ');
  const ids = unavailableIds(evidence,coverage);
  const unavailable = ids.map(id => esc(preferenceName(member,id))).join(' · ');
  const unexplained = (evidence?.missingSignalIds || []).filter(id => !ids.includes(id));
  const returnedOrder = evidence?.allSignalsUnavailable && Number.isInteger(evidence.returnedRank)
    ? `${esc(t('返回顺序：{n}；不能作为口味排名。',{n:evidence.returnedRank}))}<br>` : '';
  return `${returnedOrder}${contributions ? label('返回的偏好依据：') + contributions : label(evidence?.explanationMissing ? '解释不足：未返回解释。' : '解释不足：未返回信号贡献。')}${unavailable ? `<br>${label('不可用的已确认信号：')}${unavailable}` : ''}${unexplained.length ? `<br>${label('部分已确认偏好未列入解释；不能据此认定没有作用。')}` : ''}`;
}
function explanationPanel(options, count) {
  if (!options.enabled) return '';
  const state = options.state || {status:'unavailable'};
  const busy = state.status === 'loading';
  const disabled = busy || state.status === 'unavailable' || state.status === 'ready';
  const notice = state.status === 'error' ? '解释暂不可用，原有排名和证据仍可查看。'
    : state.status === 'unavailable' ? '当前候选暂不支持文字解释，原有证据仍可查看。'
    : busy ? '正在整理解释…' : '';
  return `<div class="local-explanation"><button type="button" class="ghost" data-explain-results ${disabled ? 'disabled' : ''}>${label(busy ? '正在整理解释…' : state.status === 'ready' ? '已生成解释' : '解释这些结果')}</button><p>${label('文字解释仅整理已返回的证据；排名和确认状态以原有结果为准。')}</p>${count > 12 ? `<p>${label('一次解释当前列表前 12 个候选。')}</p>` : ''}<p class="explanation-status" role="status">${notice ? label(notice) : ''}</p>${state.status === 'ready' ? `<p id="generated-explanation"><b>${label('文字解释')}</b><br>${esc(state.explanation.summary)}</p>` : ''}</div>`;
}

export function renderCommonComparison(result, comparison, state, filteredCount = 0, explanationOptions = {}) {
  const members = result.members || [];
  const candidates = comparison.candidates || [];
  const memberName = id => readable(members.find(member => member.id === id)?.name,'成员');
  const source = result.evidenceKind === 'synthetic' || result.source === 'synthetic' ? t('合成测试数据；不是 Qloo 实测。') : result.source === 'live' ? t('Qloo 真实口味证据') : messageFor(result.reason);
  const coverage = members.map(member => {
    const item = comparison.coverage?.[member.id];
    const unavailable = (item?.unavailableSignalIds || []).map(id => esc(preferenceName(member,id))).join(' · ');
    const status = !item?.hasSignals ? label('未排名：没有已确认偏好') : item.allSignalsUnavailable
      ? `${label('全部已确认信号不可用；不能作为口味排名或自动替代依据。')} · ${esc(t('返回 {n}/{total} 个候选；返回顺序不能用于口味比较。',{n:item.returnedCount,total:item.poolCount}))}`
      : esc(t('返回 {n}/{total} 个候选排名', {n:item.returnedCount,total:item.poolCount}));
    return `<li>${esc(readable(member.name,'成员'))} · ${status}${item?.hasSignals && !item.complete && !item.allSignalsUnavailable ? ` · ${label('覆盖不完整')}` : ''}${unavailable ? ` · ${label('不可用的已确认信号：')}${unavailable}` : ''}</li>`;
  }).join('');
  const rankFor = (candidate, member) => {
    const coverage = comparison.coverage?.[member.id];
    if (coverage?.hasSignals === false || coverage?.allSignalsUnavailable || candidate.memberEvidence?.[member.id]?.allSignalsUnavailable) return null;
    return Number.isInteger(candidate.memberRanks?.[member.id]) ? candidate.memberRanks[member.id] : null;
  };
  const generated = explanationOptions.enabled && explanationOptions.state?.status === 'ready' ? explanationOptions.state.explanation.candidates : [];
  const matrix = candidates.length ? `<div class="matrix-scroll"><table class="score-matrix"><thead><tr><th>${label('共同候选')}</th>${members.map(member => `<th>${esc(readable(member.name,'成员'))}</th>`).join('')}<th>${label('排名分歧')}</th><th>${label('选择')}</th></tr></thead><tbody>${candidates.map(candidate => {
    const ranks = members.map(member => rankFor(candidate,member)).filter(Number.isFinite);
    const spread = ranks.length > 1 ? Math.max(...ranks) - Math.min(...ranks) : null;
    const chosen = state?.selected?.some(item => sameCandidatePlace(item,candidate));
    const excluded = state?.rejectedIds?.includes(candidate.id) || state?.rejectedCandidates?.some(item => sameCandidatePlace(item,candidate)) || candidate.excluded;
    const cells = members.map(member => `<td>${rankFor(candidate,member) != null ? `#${rankFor(candidate,member)}` : '—'}</td>`).join('');
    const support = [...new Set(members.flatMap(member => contributionNames(candidate.memberEvidence?.[member.id],member,comparison.coverage?.[member.id])))];
    const candidateExplanation = generated.find(item => item.id === candidate.id);
    return `<tr><th>${esc(readable(candidate.name,'候选地点'))}${candidate.address ? `<small>${esc(readable(candidate.address,''))}</small>` : ''}<small class="candidate-evidence">${support.length ? label('返回的偏好依据：') + support.map(esc).join(' · ') : label('暂无可用偏好解释。')}</small>${candidateExplanation ? `<p class="candidate-explanation" data-explanation-id="${esc(candidate.id)}">${esc(candidateExplanation.text)}</p>` : ''}<details><summary>${label('查看返回的解释')}</summary>${members.map(member => `<p><b>${esc(readable(member.name,'成员'))}</b><br>${evidenceText(candidate.memberEvidence?.[member.id],member,comparison.coverage?.[member.id])}</p>`).join('')}</details></th>${cells}<td>${spread == null ? '—' : esc(t('相差 {n} 位',{n:spread}))}</td><td><button type="button" class="ghost" data-common-select data-candidate-id="${esc(candidate.id)}" data-version="${state?.version ?? 0}" ${chosen || excluded || state?.pending ? 'disabled' : ''}>${label(excluded ? '已排除' : chosen ? '已选入草案' : '选择并查看修改')}</button></td></tr>`;
  }).join('')}</tbody></table></div>` : `<p class="empty-note">${label('没有可比较的共同候选；请调整偏好或目的地后重试。')}</p>`;
  const duplicates = comparison.possibleDuplicates?.length ? `<p class="review-notice">${label('疑似重复地点（尚未合并）：')}${comparison.possibleDuplicates.map(item => esc(readable(item.name,'候选地点'))).join(' · ')}</p>` : '';
  const common = comparison.unrankedMemberIds?.length || comparison.incompleteMemberIds?.length || !candidates.length
    ? t('无法判断共同前五：部分成员未排名或返回不完整。')
    : comparison.commonTop5Ids?.length ? t('共同前五包含 {n} 个候选；仍需逐项确认取舍。',{n:comparison.commonTop5Ids.length}) : t('没有共同前五；请查看成员间的排名取舍。');
  const technical = {source:result.source,poolWarnings:result.poolWarnings,poolQueryWarning:result.poolQueryWarning,coverage:comparison.coverage,candidates:candidates.map(candidate => ({id:candidate.id,sourceTag:candidate.sourceTag,evidence:candidate.memberEvidence}))};
  const technicalDetails = `<details class="technical-evidence"><summary>${label('技术详情')}</summary><pre>${esc(JSON.stringify(technical,null,2))}</pre></details>`;
  const incompleteResponses = (comparison.incompleteMemberIds || []).filter(id => !comparison.coverage?.[id]?.allSignalsUnavailable);
  return `<section class="members-result reveal" id="common-comparison-panel"><div class="result-heading"><div><p class="seam-kicker">02 · Qloo</p><h2>${label('共同候选比较')}</h2></div><p class="source-note">${esc(source)}</p></div><p>${label('每位有偏好的成员排序同一候选池；跨查询亲和度不相加。排名只是口味信号，不代表全员同意。')}</p><ul>${coverage}</ul><p class="review-notice">${esc(common)}</p>${incompleteResponses.length ? `<p>${label('部分成员的返回不完整：')}${incompleteResponses.map(memberName).map(esc).join(' · ')}</p>` : ''}${duplicates}${explanationPanel(explanationOptions,candidates.length)}${matrix}<p>${esc(t('硬拒绝已过滤 {n} 项',{n:filteredCount}))}</p><p>${label('缺少的解释不会补写；价格、营业和路程仍待核实。')}</p>${technicalDetails}<button type="button" class="play" data-shell-next="negotiation">${label('查看路线与修改 →')}</button> <button type="button" class="ghost" data-shell-next="members">${label('返回成员输入')}</button></section>`;
}
