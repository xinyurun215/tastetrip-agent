// The explanation layer receives facts and returns strings, never review state.
const statuses = ['ranked', 'partial', 'all_unavailable', 'no_preferences'];
const technical = /qloo:entity|(?:urn|synthetic):|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const fail = () => { throw Object.assign(new Error('Invalid explanation data'), {code:'invalid_response'}); };
const object = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail();
};
const string = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail();
  return value;
};
const list = (value, max, min = 0) => { if (!Array.isArray(value) || value.length > max || value.length < min) fail(); return value; };
const names = (value, max = 3) => list(value,max).map(item => { string(item); if (technical.test(item)) fail(); return item; });
const cleanName = (value, fallback) => {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  return !name || technical.test(name) ? fallback : name.slice(0,120);
};

export function confirmedPreferenceName(member, id, language = 'zh') {
  const en = language === 'en', entities = member.entities || [];
  const index = entities.findIndex(item => item.id === id), entity = entities[index];
  const fallback = en ? 'A confirmed preference' : '某项已确认偏好';
  const name = cleanName(entity?.name,fallback);
  const sameTitle = entities.filter(item => cleanName(item.name,fallback) === name);
  if (!entity || sameTitle.length < 2) return name;
  const kind = (en ? {movie:'film',artist:'artist',book:'book'} : {movie:'电影',artist:'音乐人',book:'书籍'})[entity.kind];
  const duplicateKind = sameTitle.filter(item => item.kind === entity.kind).length > 1;
  const suffix = kind ? `${kind}${duplicateKind ? ` ${index+1}` : ''}` : en ? `preference ${index+1}` : `偏好 ${index+1}`;
  return `${name.slice(0,100)} (${suffix})`;
}

export function buildExplanationSnapshot(result, comparison, language = 'zh') {
  const en = language === 'en';
  const members = result.members || [];
  if (members.length > 6) fail(); // Keep the local prompt bounded; the deterministic view still supports larger groups.
  const preferenceName = (member, id) => confirmedPreferenceName(member,id,language);
  const memberFacts = members.map((member, index) => {
    const coverage = comparison.coverage?.[member.id];
    const status = !coverage?.hasSignals ? 'no_preferences' : coverage.allSignalsUnavailable ? 'all_unavailable'
      : !coverage.complete || coverage.unavailableSignalIds?.length ? 'partial' : 'ranked';
    return {name:cleanName(member.name,en ? `Member ${index+1}` : `成员 ${index+1}`),status,
      unavailablePreferences:(coverage?.unavailableSignalIds || []).slice(0,3).map(id => preferenceName(member,id))};
  });
  const candidates = (comparison.candidates || []).slice(0,12).map((candidate,index) => ({
    id:candidate.id,
    name:cleanName(candidate.name,en ? `Candidate ${index+1}` : `候选地点 ${index+1}`),
    evidence:members.map((member,mi) => {
      const evidence = candidate.memberEvidence?.[member.id];
      const unranked = ['all_unavailable','no_preferences'].includes(memberFacts[mi].status);
      const unavailable = evidence?.unavailableSignalIds || comparison.coverage?.[member.id]?.unavailableSignalIds || [];
      const contributions = unranked ? [] : (evidence?.contributions || [])
        .filter(item => !unavailable.includes(item.entityId) && member.entities?.some(entity => entity.id === item.entityId))
        .slice(0,3).map(item => preferenceName(member,item.entityId));
      const rank = !unranked && Number.isInteger(candidate.memberRanks?.[member.id]) ? candidate.memberRanks[member.id] : null;
      return {member:memberFacts[mi].name,rank,contributions,
        missingExplanation:!contributions.length || Boolean(evidence?.missingSignalIds?.some(id => !unavailable.includes(id))),
        unavailablePreferences:unavailable.slice(0,3).map(id => preferenceName(member,id)),
        status:unranked ? memberFacts[mi].status : rank == null ? 'partial' : memberFacts[mi].status};
    }),
  }));
  const known = comparison.candidates?.length && !comparison.unrankedMemberIds?.length && !comparison.incompleteMemberIds?.length;
  const commonTop5Status = !known ? 'unknown' : comparison.commonTop5Ids?.length ? 'present' : 'none';
  const commonTop5Names = commonTop5Status === 'present' ? comparison.commonTop5Ids.slice(0,12).map(id => {
    const index = comparison.candidates.findIndex(item => item.id === id);
    return cleanName(comparison.candidates[index]?.name,en ? `Candidate ${index+1}` : `候选地点 ${index+1}`);
  }) : [];
  return validateExplanationSnapshot({language:en ? 'en' : 'zh',source:result.evidenceKind === 'synthetic' || result.source === 'synthetic' ? 'synthetic' : result.source === 'live' ? 'live' : 'unavailable',members:memberFacts,candidates,commonTop5Status,commonTop5Names});
}

export function validateExplanationSnapshot(value) {
  object(value,['language','source','members','candidates','commonTop5Status','commonTop5Names']);
  if (!['zh','en'].includes(value.language) || !['synthetic','live','unavailable'].includes(value.source)
      || !['present','none','unknown'].includes(value.commonTop5Status)) fail();
  const members = list(value.members,6,1).map(member => {
    object(member,['name','status','unavailablePreferences']);
    if (!statuses.includes(member.status)) fail();
    return {name:names([member.name])[0],status:member.status,unavailablePreferences:names(member.unavailablePreferences)};
  });
  const ids = new Set();
  const candidates = list(value.candidates,12,1).map(candidate => {
    object(candidate,['id','name','evidence']);
    if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(candidate.id) || ids.has(candidate.id)) fail();
    ids.add(candidate.id);
    const evidence = list(candidate.evidence,members.length,members.length).map((item,index) => {
      object(item,['member','rank','contributions','missingExplanation','unavailablePreferences','status']);
      if (item.member !== members[index].name || !statuses.includes(item.status) || typeof item.missingExplanation !== 'boolean'
          || (item.rank !== null && (!Number.isInteger(item.rank) || item.rank < 1 || item.rank > 1000))) fail();
      const contributions=names(item.contributions), unavailablePreferences=names(item.unavailablePreferences);
      if (['no_preferences','all_unavailable'].includes(item.status) && (item.rank !== null || contributions.length)) fail();
      if (['no_preferences','all_unavailable'].includes(members[index].status) && item.status !== members[index].status) fail();
      if (contributions.some(name => unavailablePreferences.includes(name))) fail();
      return {member:item.member,rank:item.rank,contributions,missingExplanation:item.missingExplanation,unavailablePreferences,status:item.status};
    });
    return {id:candidate.id,name:names([candidate.name])[0],evidence};
  });
  const commonTop5Names=names(value.commonTop5Names,12);
  if ((value.commonTop5Status === 'present') !== Boolean(commonTop5Names.length)) fail();
  return {language:value.language,source:value.source,members,candidates,commonTop5Status:value.commonTop5Status,commonTop5Names};
}

export function validateExplanationResponse(value, snapshot) {
  object(value,['summary','candidates']);
  const prose = (text,max) => {
    string(text,max);
    if (technical.test(text) || /\d+(?:\.\d+)?\s*[%％]/.test(text)) fail();
    return text;
  };
  const summary=prose(value.summary,320), ids=new Set();
  const byId=new Map(list(value.candidates,snapshot.candidates.length,snapshot.candidates.length).map(item => {
    object(item,['id','text']);
    if (!snapshot.candidates.some(candidate => candidate.id === item.id) || ids.has(item.id)) fail();
    ids.add(item.id);
    return [item.id,{id:item.id,text:prose(item.text,180)}];
  }));
  return {summary,candidates:snapshot.candidates.map(item => byId.get(item.id))};
}
