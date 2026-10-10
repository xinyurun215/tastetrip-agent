import { CANONICAL } from "../data.js";
import { isCanonicalPair } from "./conflicts.js";

const TIMES = ["19:30", "20:10", "21:40", "23:15"];
const FROMS = ["a", "both", "both", "b"];

function taste(parsed, side, key) {
  return parsed[side].find((item) => item.key === key).value;
}

function qlooTag(insight) {
  return insight?.source === "live" ? "qloo:entity" : "qloo:replay";
}

function stamp(stops, tag) {
  return stops.map((stop) => ({ ...stop, sourceTag: tag, whySource: tag }));
}

function routeFromQloo(insight) {
  const tag = qlooTag(insight);
  const suggestions = [...(insight.suggestions || [])].sort((left, right) => {
    const a = typeof left.affinity === "number" ? left.affinity : -1;
    const b = typeof right.affinity === "number" ? right.affinity : -1;
    return b - a;
  });
  const entities = [...(insight.entities?.a || []), ...(insight.entities?.b || [])];
  const places = (suggestions.length ? suggestions : entities).slice(0, 4);
  const aNames = (insight.entities?.a || []).map((entity) => entity.name).join("、");
  const bNames = (insight.entities?.b || []).map((entity) => entity.name).join("、");
  return {
    name: insight.overlap?.name || "夜城交叉",
    nameEn: insight.overlap?.nameEn || "Night-city crossing",
    source: insight.source,
    sourceTag: tag,
    stops: places.map((place, index) => {
      const affinity = typeof place.affinity === "number" ? place.affinity : null;
      const score = affinity == null ? "" : ` affinity ${affinity.toFixed(2)}`;
      return {
        time: TIMES[index] || "23:15",
        name: place.name,
        nameEn: place.name,
        from: FROMS[index] || "both",
        detail: score ? `${place.name} ·${score}` : place.name,
        whyBoth: score
          ? `图谱把「${place.name}」排在${score}。信号是 A 的 ${aNames}，和 B 的 ${bNames}。`
          : `图谱建议了「${place.name}」。信号是 A 的 ${aNames}，和 B 的 ${bNames}。响应里没有亲和度，这里不补数字。`,
        whyBothEn: score
          ? `${place.name} is ranked at${score} from both sets of entities.`
          : `${place.name} comes from both sets of entities. No affinity was in the response.`,
        sourceTag: tag,
        whySource: tag,
        ...(affinity == null ? {} : { affinity }),
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
