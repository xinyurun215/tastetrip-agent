/** Fixed fake demo. This page never calls Qloo. */

export const FIELD_LABELS = ["作品", "音乐", "饮食"];

export const DEMO_INPUT = {
  a: ["《布达佩斯大饭店》", "爵士 Jazz", "火锅"],
  b: ["Marvel", "嘻哈 Hip-hop", "寿司"],
};

/** Flat placeholder fills. Not photos. Real art comes from Qloo entities later. */
export const POSTER_COLORS = {
  a: ["#111111", "#F5C518", "#F4F4F0"],
  b: ["#111111", "#F4F4F0", "#FF4D1C"],
};

export const POSTER_INK = {
  a: ["#F4F4F0", "#111111", "#111111"],
  b: ["#F4F4F0", "#111111", "#111111"],
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
        title: "粉彩对称的旧世界",
        detail: "《布达佩斯大饭店》的步调是缓慢、对称、暖色。",
      },
      b: {
        title: "霓虹巨型都会",
        detail: "Marvel 要高楼、速度，和亮到过头的夜。",
      },
    },
    {
      index: "02",
      label: "用餐方式",
      labelEn: "Dining style",
      a: {
        title: "围坐分享的火锅",
        detail: "一只锅、一桌人、一起下筷子。",
      },
      b: {
        title: "台前精确的寿司",
        detail: "一份一份，看厨师的手。",
      },
    },
  ],
  intersection: {
    name: "都会夜生活",
    nameEn: "Urban nightlife",
    stops: [
      {
        time: "19:30",
        name: "对称旅馆大堂",
        nameEn: "Symmetry Lobby",
        from: "a",
        detail: "只借旅馆的对称进场，而且只留到天黑。白天的老城不排进去。",
        whyBoth: "A 认得这间旅馆的对称，B 认得窗外的夜城灯光。同一间大堂，两边都有画面。",
        whyBothEn: "A gets the hotel symmetry, B gets the night skyline. Same lobby.",
      },
      {
        time: "20:10",
        name: "双柜台夜食堂",
        nameEn: "Twin-Counter Night Canteen",
        from: "both",
        detail: "火锅和寿司并成一张柜台，晚饭不再拆成两家店。",
        whyBoth: "谁都不用退出这顿饭。火锅还在左手，寿司还在右手。",
        whyBothEn: "Hotpot and sushi share one counter. Nobody leaves dinner.",
      },
      {
        time: "21:40",
        name: "爵士转角 → 嘻哈地下室",
        nameEn: "Jazz Corner, then the Hip-hop Cellar",
        from: "both",
        detail: "先三首爵士，再沿同一条夜街走八分钟进嘻哈场。",
        whyBoth: "两段都是夜场。路线只是让爵士和嘻哈一前一后，而不是二选一。",
        whyBothEn: "Jazz then hip-hop, both after dark, on one street.",
      },
      {
        time: "23:15",
        name: "天台双银幕",
        nameEn: "Rooftop Double Screen",
        from: "b",
        detail: "一块银幕是粉彩旅馆，一块是漫威夜景。",
        whyBoth: "谁也没赢下整座城。重叠的就是都会夜生活这一段。",
        whyBothEn: "Two screens, one night city. That is the overlap.",
      },
    ],
  },
};
