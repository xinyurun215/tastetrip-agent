import { t, messageFor } from './i18n.js';
import { sameCandidatePlace } from './pipeline/commonCandidates.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = value => esc(t(value));
const kinds = ['movie', 'artist', 'book'];
const kindLabel = kind => t({movie:'电影（可选）',artist:'音乐人（可选）',book:'书籍（可选）'}[kind] || kind);
const text = value => String(value ?? '').trim();
const fail = code => { throw Object.assign(new Error(code), {code}); };
const asList = value => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
const warningsText = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(item => esc(typeof item === 'string' ? item : JSON.stringify(item))).join(' · ');

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
  const external = entity.external ?? entity.properties?.external;
  const isbn = asList(entity.isbn13).join(', ');
  return [entity.types?.join(', '),entity.year,entity.disambiguation,isbn ? `ISBN ${isbn}` : '',
    external && Object.keys(external).length ? JSON.stringify(external) : '',`ID ${entity.id}`].filter(Boolean).map(esc).join(' · ');
}

export function renderEntityConfirmation(search, choices = {}) {
  const members = (search.members || []).map((member, mi) => `<article class="member-entity"><h3>${esc(member.name)}</h3>${(member.preferences || []).map((preference, pi) => {
    const key = `${mi}:${pi}`;
    const option = (value, content) => `<label class="entity-option"><input type="radio" data-entity-choice data-choice-key="${key}" name="entity-${mi}-${pi}" value="${esc(value)}" ${choices[key] === String(value) ? 'checked' : ''} /><span>${content}</span></label>`;
    return `<fieldset class="entity-choices"><legend>${esc(kindLabel(preference.kind))} · ${esc(preference.query)}</legend>${(preference.matches || []).map(entity => option(entity.id, `<b>${esc(entity.name)}</b><small>${entityFacts(entity)}</small>`)).join('')}${!preference.matches?.length ? `<p>${label('未找到匹配实体；可以跳过或返回修改。')}</p>` : ''}${option('__skip__',label('跳过此偏好'))}</fieldset>`;
  }).join('') || `<p>${label('没有已确认偏好；此成员不参与排名。')}</p>`}</article>`).join('');
  return `<section class="members-result reveal"><div class="result-heading"><div><p class="seam-kicker">02 · Qloo</p><h2>${label('确认准确的文化实体')}</h2></div></div><p>${label('每条输入请选择一个准确实体或明确跳过；不会自动选中首条结果。')}</p><form id="entity-confirmation-form"><div class="member-entities">${members}</div><p id="entity-confirmation-error" class="review-notice" role="status"></p><button class="play" type="submit">${label('确认实体并比较共同候选')}</button> <button type="button" class="ghost" data-shell-next="members">${label('返回成员输入')}</button></form></section>`;
}

function evidenceText(evidence, member) {
  const contributions = (evidence?.contributions || []).map(item => {
    const name = item.name || member.entities?.find(entity => entity.id === item.entityId)?.name || item.entityId;
    return `${esc(name)}${typeof item.score === 'number' ? ` (${esc(item.score)})` : ''}`;
  }).join(' · ');
  const warnings = warningsText([evidence?.warning,evidence?.warnings,evidence?.queryWarning].filter(Boolean));
  return `${contributions || label(evidence?.explanationMissing ? '解释不足：未返回解释。' : '解释不足：未返回信号贡献。')}${evidence?.missingSignalIds?.length ? `<br>${label('部分已确认偏好未列入解释；不能据此认定没有作用。')}` : ''}${warnings ? `<br>${label('Qloo 返回的警告：')}${warnings}` : ''}`;
}

export function renderCommonComparison(result, comparison, state, filteredCount = 0) {
  const members = result.members || [];
  const candidates = comparison.candidates || [];
  const memberName = id => members.find(member => member.id === id)?.name || id;
  const source = result.evidenceKind === 'synthetic' || result.source === 'synthetic' ? `${t('合成测试数据；不是 Qloo 实测。')} · mock:fixture` : result.source === 'live' ? `${t('Qloo 真实口味证据')} · qloo:entity` : messageFor(result.reason);
  const coverage = members.map(member => {
    const item = comparison.coverage?.[member.id];
    const warnings = warningsText([item?.warnings,item?.queryWarning].filter(Boolean));
    return `<li>${esc(member.name)} · ${item?.hasSignals ? esc(t('返回 {n}/{total} 个候选排名', {n:item.returnedCount,total:item.poolCount})) : label('未排名：没有已确认偏好')}${item?.hasSignals && !item.complete ? ` · ${label('覆盖不完整')}` : ''}${warnings ? ` · ${label('Qloo 返回的警告：')}${warnings}` : ''}</li>`;
  }).join('');
  const matrix = candidates.length ? `<div class="matrix-scroll"><table class="score-matrix"><thead><tr><th>${label('共同候选')}</th>${members.map(member => `<th>${esc(member.name)}</th>`).join('')}<th>${label('排名分歧')}</th><th>${label('选择')}</th></tr></thead><tbody>${candidates.map(candidate => {
    const ranks = Object.values(candidate.memberRanks || {}).filter(Number.isFinite);
    const spread = ranks.length > 1 ? Math.max(...ranks) - Math.min(...ranks) : null;
    const chosen = state?.selected?.some(item => sameCandidatePlace(item,candidate));
    const excluded = state?.rejectedIds?.includes(candidate.id) || state?.rejectedCandidates?.some(item => sameCandidatePlace(item,candidate)) || candidate.excluded;
    const cells = members.map(member => `<td>${Number.isFinite(candidate.memberRanks?.[member.id]) ? `#${candidate.memberRanks[member.id]}` : '—'}</td>`).join('');
    return `<tr><th>${esc(candidate.name)}${candidate.address ? `<small>${esc(candidate.address)}</small>` : ''}<small>${esc(candidate.sourceTag || 'qloo:entity')}</small><details><summary>${label('查看返回的解释')}</summary>${members.map(member => `<p><b>${esc(member.name)}</b><br>${evidenceText(candidate.memberEvidence?.[member.id],member)}</p>`).join('')}</details></th>${cells}<td>${spread == null ? '—' : esc(t('相差 {n} 位',{n:spread}))}</td><td><button type="button" class="ghost" data-common-select data-candidate-id="${esc(candidate.id)}" data-version="${state?.version ?? 0}" ${chosen || excluded || state?.pending ? 'disabled' : ''}>${label(excluded ? '已排除' : chosen ? '已选入草案' : '选择并查看修改')}</button></td></tr>`;
  }).join('')}</tbody></table></div>` : `<p class="empty-note">${label('没有可比较的共同候选；请调整偏好或目的地后重试。')}</p>`;
  const duplicates = comparison.possibleDuplicates?.length ? `<p class="review-notice">${label('疑似重复地点（尚未合并）：')}${comparison.possibleDuplicates.map(item => esc(item.name)).join(' · ')}</p>` : '';
  const common = comparison.unrankedMemberIds?.length || comparison.incompleteMemberIds?.length || !candidates.length
    ? t('无法判断共同前五：部分成员未排名或返回不完整。')
    : comparison.commonTop5Ids?.length ? t('共同前五包含 {n} 个候选；仍需逐项确认取舍。',{n:comparison.commonTop5Ids.length}) : t('没有共同前五；请查看成员间的排名取舍。');
  const poolWarnings = warningsText([result.poolWarnings,result.poolQueryWarning].filter(Boolean));
  return `<section class="members-result reveal" id="common-comparison-panel"><div class="result-heading"><div><p class="seam-kicker">02 · Qloo</p><h2>${label('共同候选比较')}</h2></div><p class="source-note">${esc(source)}</p></div><p>${label('每位有偏好的成员排序同一候选池；跨查询亲和度不相加。排名只是口味信号，不代表全员同意。')}</p><ul>${coverage}</ul><p class="review-notice">${esc(common)}</p>${comparison.incompleteMemberIds?.length ? `<p>${label('部分成员的返回不完整：')}${comparison.incompleteMemberIds.map(memberName).map(esc).join(' · ')}</p>` : ''}${poolWarnings ? `<p class="review-notice">${label('Qloo 返回的警告：')}${poolWarnings}</p>` : ''}${duplicates}${matrix}<p>${esc(t('硬拒绝已过滤 {n} 项',{n:filteredCount}))}</p><p>${label('缺少的解释不会补写；价格、营业和路程仍待核实。')}</p><button type="button" class="play" data-shell-next="negotiation">${label('查看路线与修改 →')}</button> <button type="button" class="ghost" data-shell-next="members">${label('返回成员输入')}</button></section>`;
}
