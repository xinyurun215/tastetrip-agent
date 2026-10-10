import { CANONICAL } from "./data.js";

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function has(value, keys) {
  const text = norm(value);
  return keys.some((key) => text.includes(norm(key)));
}

export function isCanonical(input) {
  const [aFilm, aMusic, aFood] = input.a;
  const [bFilm, bMusic, bFood] = input.b;
  return (
    has(aFilm, ["布达佩斯", "budapest"]) &&
    has(aMusic, ["爵士", "jazz"]) &&
    has(aFood, ["火锅", "hotpot", "hot pot"]) &&
    has(bFilm, ["marvel", "漫威"]) &&
    has(bMusic, ["hip-hop", "hiphop", "嘻哈"]) &&
    has(bFood, ["寿司", "sushi"])
  );
}

function clean(input) {
  return {
    a: input.a.map((item) => String(item ?? "").trim()),
    b: input.b.map((item) => String(item ?? "").trim()),
  };
}

function genericPlan(input) {
  const [aFilm, aMusic, aFood] = input.a;
  const [bFilm, bMusic, bFood] = input.b;

  return {
    mode: "generic",
    travelers: {
      a: { name: "旅人 A", tastes: input.a },
      b: { name: "旅人 B", tastes: input.b },
    },
    conflicts: [
      {
        index: "01",
        label: "城市气质",
        labelEn: "City vibe",
        a: { title: aFilm, detail: `A 的画面把城市拉向「${aFilm}」。` },
        b: { title: bFilm, detail: `B 的画面把城市拉向「${bFilm}」。` },
      },
      {
        index: "02",
        label: "用餐方式",
        labelEn: "Dining style",
        a: { title: aFood, detail: `A 把晚饭交给「${aFood}」。` },
        b: { title: bFood, detail: `B 把晚饭交给「${bFood}」。` },
      },
    ],
    intersection: {
      name: "都会夜生活",
      nameEn: "Urban nightlife",
      stops: [
        {
          time: "19:30",
          name: `${aFilm} 的夜场入口`,
          nameEn: "Night entrance",
          from: "a",
          detail: `只借 A 的画面开场。B 的「${bFilm}」留到最后。`,
          whyBoth: `两边都还在夜里。A 看到「${aFilm}」，B 的画面排在后面，没有被丢掉。`,
          whyBothEn: "Both stay on the night route. A's image opens, B's is kept for later.",
        },
        {
          time: "20:10",
          name: "双柜台夜食堂",
          nameEn: "Twin-Counter Night Canteen",
          from: "both",
          detail: `「${aFood}」和「${bFood}」并桌。`,
          whyBoth: `晚饭不用拆开。「${aFood}」和「${bFood}」各留一口。`,
          whyBothEn: "Dinner stays one table. Each person keeps a seat.",
        },
        {
          time: "21:40",
          name: `${aMusic} → ${bMusic}`,
          nameEn: "Two rooms, one nightlife street",
          from: "both",
          detail: "同一条夜街，先 A 的音乐，再 B 的场子。",
          whyBoth: `「${aMusic}」和「${bMusic}」都是夜场，只是前后脚。`,
          whyBothEn: "Both music tastes get a room. The street just orders them.",
        },
        {
          time: "23:15",
          name: "天台双银幕",
          nameEn: "Rooftop Double Screen",
          from: "b",
          detail: `「${aFilm}」和「${bFilm}」各占半块银幕。`,
          whyBoth: "同一片夜色把两个画面接住。重叠的是都会夜生活。",
          whyBothEn: "One night city holds both images. That is the overlap.",
        },
      ],
    },
  };
}

export function analyze(raw) {
  const input = clean(raw);
  const missing = [...input.a, ...input.b].some((value) => value.length === 0);
  if (missing) {
    return { ok: false, reason: "六项口味都填上之后，才能撕开票根并重排。" };
  }
  if (isCanonical(input)) {
    return {
      ok: true,
      plan: {
        ...CANONICAL,
        travelers: {
          a: { name: "旅人 A", tastes: input.a },
          b: { name: "旅人 B", tastes: input.b },
        },
      },
    };
  }
  return { ok: true, plan: genericPlan(input) };
}
