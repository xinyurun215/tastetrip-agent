/** Fixed taste pair. The handwritten itinerary below is only the no-graph baseline. */

export const FIELD_LABELS = ["作品", "音乐", "饮食"];

export const DEMO_PAIR_LABEL = "小众爵士 × 夜宵";

export const DEMO_INPUT = {
  a: ["Whiplash", "小众爵士 Kamasi Washington", "Blue Note"],
  b: ["深夜食堂", "深夜食堂", "夜宵"],
};

export const CANONICAL = {
  mode: "canonical",
  travelers: {
    a: { name: "旅人 A", tastes: DEMO_INPUT.a },
    b: { name: "旅人 B", tastes: DEMO_INPUT.b },
  },
  conflicts: [
    {
      index: "01",
      label: "城市气质",
      labelEn: "City vibe",
      a: {
        title: "小众爵士的窄房间",
        detail: "A 要的是曲子，不是景点，也不是旅馆。",
      },
      b: {
        title: "后半夜只剩吃的",
        detail: "B 不看演出。夜里只留得下一顿热的。",
      },
    },
    {
      index: "02",
      label: "用餐方式",
      labelEn: "Dining style",
      a: {
        title: "吧台边的一杯",
        detail: "吃是附带的，座位要靠着音乐。",
      },
      b: {
        title: "只要夜宵",
        detail: "不点酒，也不进演出厅。只要还在出餐。",
      },
    },
  ],
  intersection: {
    name: "都会夜生活",
    nameEn: "Urban nightlife",
    stops: [
      {
        time: "19:30",
        name: "爵士窄门",
        nameEn: "Narrow jazz door",
        from: "a",
        detail: "规则先给 A 一间小场，不排旅馆。",
        whyBoth: "A 听到小众爵士。B 还没吃饭，所以这站只作开场。",
        whyBothEn: "A gets the small jazz room. B has not eaten, so this stop only opens the night.",
      },
      {
        time: "20:10",
        name: "夜宵窗口",
        nameEn: "Late-night window",
        from: "b",
        detail: "热食窗口，不进演出厅。",
        whyBoth: "B 要的是夜宵。A 可以站着听完这一段再走。",
        whyBothEn: "B gets late-night food. A can stand through this stop.",
      },
      {
        time: "21:40",
        name: "只留一首",
        nameEn: "One tune only",
        from: "both",
        detail: "同一条夜里只留一首，不改成景点。",
        whyBoth: "一首就够把爵士留下。B 的夜宵不因此被取消。",
        whyBothEn: "One tune keeps the jazz. B's late meal stays on the route.",
      },
      {
        time: "23:15",
        name: "热食收口",
        nameEn: "Hot food, last stop",
        from: "b",
        detail: "收在还出餐的地方。",
        whyBoth: "夜结束在 B 的夜宵上。A 的曲子已经听过。",
        whyBothEn: "The night ends on B's late food. A's tune already happened.",
      },
    ],
  },
};
