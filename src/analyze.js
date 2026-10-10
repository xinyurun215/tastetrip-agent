import { CANONICAL, DEMO_INPUT } from "./data.js";

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
        a: {
          title: aFilm,
          detail: `A 的作品口味把城市气氛拉向「${aFilm}」。这和 B 不是同一座城。`,
        },
        b: {
          title: bFilm,
          detail: `B 的作品口味把城市气氛拉向「${bFilm}」。白天若各走各的，路线会在这里拆开。`,
        },
      },
      {
        index: "02",
        label: "用餐方式",
        labelEn: "Dining style",
        a: {
          title: aFood,
          detail: `A 想把一餐交给「${aFood}」。`,
        },
        b: {
          title: bFood,
          detail: `B 想把一餐交给「${bFood}」。两家店会把晚上撕成两段。`,
        },
      },
    ],
    displaced: {
      a: [aFilm, aMusic, aFood].map((item) => `${item} · 白天`),
      b: [bFilm, bMusic, bFood].map((item) => `${item} · 白天`),
    },
    intersection: {
      name: "都会夜生活",
      nameEn: "Urban nightlife",
      why: `改过的口味仍按同一条规则假演：不平均成一个中间景点，把「${aFilm} / ${bFilm}」的城市冲突和「${aFood} / ${bFood}」的用餐冲突收进一夜。音乐（${aMusic}、${bMusic}）改成前后场，而不是二选一。`,
      whyEn:
        "Still local fake data. The edited tastes are folded into the same urban-nightlife reorder.",
      summary: [
        ["19:30", "夜场入口"],
        ["20:10", "并桌晚饭"],
        ["21:40", "两段音乐"],
        ["23:15", "天台收束"],
      ],
      stops: [
        {
          time: "19:30",
          name: `${aFilm} 的夜场入口`,
          nameEn: "Night entrance",
          detail: `只借 A 的画面气氛开场，不排白天行程。B 的「${bFilm}」留到最后一块银幕。`,
        },
        {
          time: "20:10",
          name: "双柜台夜食堂",
          nameEn: "Twin-Counter Night Canteen",
          detail: `「${aFood}」和「${bFood}」并桌。用餐冲突不再拆成两家餐厅。`,
        },
        {
          time: "21:40",
          name: `${aMusic} → ${bMusic}`,
          nameEn: "Two rooms, one nightlife street",
          detail: "同一条夜街，先听 A 的音乐，再走去 B 的场子。",
        },
        {
          time: "23:15",
          name: "天台双银幕",
          nameEn: "Rooftop Double Screen",
          detail: `交集仍收在都会夜生活。「${aFilm}」和「${bFilm}」各占半块银幕。`,
        },
      ],
    },
  };
}

export function analyze(raw) {
  const input = clean(raw);
  const missing = [...input.a, ...input.b].some((value) => value.length === 0);
  if (missing) {
    return { ok: false, reason: "六项口味都填上之后，才能标出冲突并重排夜路。" };
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

export { DEMO_INPUT };
