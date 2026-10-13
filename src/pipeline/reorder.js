import { CANONICAL } from "../data.js";
import { isCanonicalPair } from "./conflicts.js";

const TIMES = ["19:30", "20:10", "21:40", "23:15"];
const FROMS = ["a", "both", "both", "b"];

function taste(parsed, side, key) {
  return parsed[side].find((item) => item.key === key).value;
}

function qlooTag() {
  return "qloo:entity";
}

function stamp(stops, tag) {
  return stops.map((stop) => ({ ...stop, sourceTag: tag, whySource: tag }));
}

function mutual(place) {
  const a = typeof place.affinityA === "number" ? place.affinityA : null;
  const b = typeof place.affinityB === "number" ? place.affinityB : null;
  if (a != null && b != null) return Math.min(a, b);
  if (a != null) return a;
  if (b != null) return b;
  return typeof place.affinity === "number" ? place.affinity : -1;
}

function tagNames(place) {
  return (place.tags || []).map((tag) => (typeof tag === "string" ? tag : "")).filter(Boolean);
}

function explainBoth(place, entitiesA, entitiesB) {
  const a = typeof place.affinityA === "number" ? place.affinityA : null;
  const b = typeof place.affinityB === "number" ? place.affinityB : null;
  const aNames = (entitiesA || []).map((entity) => entity.name).filter(Boolean).join("、") || "A 的实体";
  const bNames = (entitiesB || []).map((entity) => entity.name).filter(Boolean).join("、") || "B 的实体";
  const attrs = tagNames(place).join("、");
  const attrBit = attrs ? `属性是${attrs}` : "响应里没有地点属性";
  if (a != null && b != null) {
    const gap = Math.abs(a - b);
    const gapText = gap.toFixed(2);
    if (gap < 0.03) {
      return {
        whyBoth: `A ${a.toFixed(2)}，B ${b.toFixed(2)}，差 ${gapText}，两边几乎一样，这里不把分差写大。A 的实体是${aNames}，B 的实体是${bNames}。${attrBit}。`,
        whyBothEn: `A ${a.toFixed(2)} and B ${b.toFixed(2)} differ by ${gapText}. Those are the returned scores. A is ${aNames}. B is ${bNames}. ${attrs || "No place attributes were returned."}`,
      };
    }
    const lead = a > b ? "A" : "B";
    const leadNames = a > b ? aNames : bNames;
    const otherNames = a > b ? bNames : aNames;
    return {
      whyBoth: `${lead} 更高：A ${a.toFixed(2)}，B ${b.toFixed(2)}，差 ${gapText}。更高的一侧来自${leadNames}，另一侧是${otherNames}。${attrBit}。`,
      whyBothEn: `${lead} is higher. A ${a.toFixed(2)}, B ${b.toFixed(2)}, gap ${gapText}. The higher side is ${leadNames}. The other side is ${otherNames}. ${attrs || "No place attributes were returned."}`,
    };
  }
  if (a != null || b != null) {
    const known = a != null ? `A ${a.toFixed(2)}` : `B ${b.toFixed(2)}`;
    const missing = a == null ? "A" : "B";
    return {
      whyBoth: `只返回了${known}。${missing} 这次没有分数，不补。A 的实体是${aNames}，B 的实体是${bNames}。${attrBit}。`,
      whyBothEn: `Only ${known} came back. ${missing} has no score in the response. A is ${aNames}. B is ${bNames}. ${attrs || "No place attributes were returned."}`,
    };
  }
  return {
    whyBoth: `这次没有 A/B 分数，不补数字。A 的实体是${aNames}，B 的实体是${bNames}。${attrBit}。`,
    whyBothEn: `No side scores were in the response. A is ${aNames}. B is ${bNames}. ${attrs || "No place attributes were returned."}`,
  };
}

function hasPoint(place) {
  return typeof place.lat === "number" && typeof place.lng === "number";
}

function km(left, right) {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function orderByDistance(places) {
  const located = places.filter(hasPoint);
  if (located.length < 2) return [...places].sort((left, right) => mutual(right) - mutual(left));
  const start = [...located].sort((left, right) => mutual(right) - mutual(left))[0];
  const route = [start];
  const rest = located.filter((place) => place !== start);
  while (rest.length) {
    const cursor = route[route.length - 1];
    rest.sort((left, right) => km(cursor, left) - km(cursor, right) || mutual(right) - mutual(left));
    route.push(rest.shift());
  }
  return [...route, ...places.filter((place) => !hasPoint(place))];
}

function routeFromQloo(insight) {
  const tag = qlooTag();
  const suggestions = orderByDistance(insight.suggestions || []);
  const entitiesA = insight.entities?.a || [];
  const entitiesB = insight.entities?.b || [];
  return {
    name: insight.overlap?.name || "夜城交叉",
    nameEn: insight.overlap?.nameEn || "Night-city crossing",
    source: insight.source,
    sourceTag: tag,
    stops: suggestions.slice(0, 4).map((place, index) => {
      const reason = explainBoth(place, entitiesA, entitiesB);
      const affinityA = typeof place.affinityA === "number" ? place.affinityA : null;
      const affinityB = typeof place.affinityB === "number" ? place.affinityB : null;
      const scoreA = affinityA == null ? "—" : affinityA.toFixed(2);
      const scoreB = affinityB == null ? "—" : affinityB.toFixed(2);
      return {
        time: TIMES[index] || "23:15",
        name: place.name,
        nameEn: place.name,
        from: FROMS[index] || "both",
        detail: `A ${scoreA} · B ${scoreB}`,
        ...reason,
        sourceTag: tag,
        whySource: tag,
        ...(typeof place.affinity === "number" ? { affinity: place.affinity } : {}),
        ...(affinityA == null ? {} : { affinityA }),
        ...(affinityB == null ? {} : { affinityB }),
        ...(place.city ? { city: place.city } : {}),
        ...(hasPoint(place) ? { lat: place.lat, lng: place.lng } : {}),
        ...(tagNames(place).length ? { tags: tagNames(place) } : {}),
      };
    }),
  };
}

export function reorderRoute(parsed, conflicts, insight) {
  if (insight?.fromQloo) return routeFromQloo(insight);

  if (isCanonicalPair(parsed)) {
    return {
      ...CANONICAL.intersection,
      source: insight?.source || "local",
      sourceTag: "mock:fixture",
      stops: stamp(CANONICAL.intersection.stops, "mock:fixture"),
    };
  }

  const aFilm = taste(parsed, "a", "work");
  const bFilm = taste(parsed, "b", "work");
  const aMusic = taste(parsed, "a", "music");
  const bMusic = taste(parsed, "b", "music");
  const aFood = taste(parsed, "a", "food");
  const bFood = taste(parsed, "b", "food");
  const overlap = insight?.overlap?.name || "都会夜生活";
  const overlapEn = insight?.overlap?.nameEn || "Urban nightlife";
  const diningClash = conflicts.some((conflict) => conflict.label === "用餐方式");

  return {
    name: overlap,
    nameEn: overlapEn,
    source: insight?.source || "local",
    sourceTag: "mock:fixture",
    stops: stamp([
      {
        time: "19:30",
        name: `${aFilm} 的夜场入口`,
        nameEn: "Night entrance",
        from: "a",
        detail: `只借 A 的画面开场。B 的「${bFilm}」留到最后。`,
        whyBoth: `两边都还在夜里。A 看到「${aFilm}」，B 的画面没有被丢掉。`,
        whyBothEn: "Both stay on the night route. A's image opens, B's is kept for later.",
      },
      {
        time: "20:10",
        name: diningClash ? "双柜台夜食堂" : "同一张夜桌",
        nameEn: "One night table",
        from: "both",
        detail: diningClash ? `「${aFood}」和「${bFood}」并桌。` : `两边都吃「${aFood}」，晚饭不用再争。`,
        whyBoth: diningClash
          ? `晚饭不用拆开。「${aFood}」和「${bFood}」各留一口。`
          : "这顿饭本来就重叠，所以它留在夜路的第二站。",
        whyBothEn: "Dinner stays one table instead of two restaurants.",
      },
      {
        time: "21:40",
        name: `${aMusic} → ${bMusic}`,
        nameEn: "Two rooms, one nightlife street",
        from: "both",
        detail: "同一条夜街，先 A 的音乐，再 B 的场子。",
        whyBoth: `「${aMusic}」和「${bMusic}」都放进夜里，只是前后脚。`,
        whyBothEn: "Both music tastes get a room. The street orders them.",
      },
      {
        time: "23:15",
        name: "天台双银幕",
        nameEn: "Rooftop Double Screen",
        from: "b",
        detail: `「${aFilm}」和「${bFilm}」各占半块银幕。`,
        whyBoth: `同一片夜色把两个画面接住。重叠的是${overlap}。`,
        whyBothEn: "One night city holds both images. That is the overlap.",
      },
    ], "mock:fixture"),
  };
}
