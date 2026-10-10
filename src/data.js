/** Fixed fake demo. This page never calls Qloo. */

export const FIELD_LABELS = ["作品", "音乐", "饮食"];

export const DEMO_INPUT = {
  a: ["《布达佩斯大饭店》", "爵士 Jazz", "火锅"],
  b: ["Marvel", "嘻哈 Hip-hop", "寿司"],
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
        detail:
          "《布达佩斯大饭店》的步调是缓慢、对称、暖色，像一座被仔细布置过的欧洲老城旅馆。",
      },
      b: {
        title: "霓虹巨型都会",
        detail:
          "Marvel 要的是高楼、速度，和亮到过头的夜。城市本身得像一场超级英雄戏。",
      },
    },
    {
      index: "02",
      label: "用餐方式",
      labelEn: "Dining style",
      a: {
        title: "围坐分享的火锅",
        detail: "一只锅、一桌人、辣和热气。这顿饭是一起下筷子。",
      },
      b: {
        title: "台前精确的寿司",
        detail: "一份一份、清淡、看厨师的手。这顿饭是专注，不是抢菜。",
      },
    },
  ],
  displaced: {
    a: ["粉彩老城漫步", "爵士午场", "火锅午饭"],
    b: ["漫威特展", "嘻哈市集", "寿司午饭"],
  },
  intersection: {
    name: "都会夜生活",
    nameEn: "Urban nightlife",
    why: "两套白天凑不成一条路：A 要缓慢对称的旧世界，B 要亮、大、快的超级英雄都市。真正重叠的是夜里。爵士和嘻哈都在夜间演出，火锅和寿司可以放进同一张夜市柜台，两种电影画面也都能投在天黑以后。交集不取一个平淡的中间景点，而是把整段行程重排成一夜。",
    whyEn:
      "The shared lane is urban nightlife. Split daytime plans are set aside, and the night is ordered so both tastes show up in sequence.",
    summary: [
      ["19:30", "对称旅馆大堂"],
      ["20:10", "双柜台夜食堂"],
      ["21:40", "爵士 → 嘻哈"],
      ["23:15", "天台双银幕"],
    ],
    stops: [
      {
        time: "19:30",
        name: "对称旅馆大堂",
        nameEn: "Symmetry Lobby",
        detail:
          "用《布达佩斯大饭店》的对称和暖色进场，但只留到天刚刚黑。粉彩老城的白天漫步不排进路线。",
      },
      {
        time: "20:10",
        name: "双柜台夜食堂",
        nameEn: "Twin-Counter Night Canteen",
        detail:
          "用餐冲突并成一张桌子：左手共享火锅，右手寿司台。不再为了吃饭拆成两家餐厅。",
      },
      {
        time: "21:40",
        name: "爵士转角 → 嘻哈地下室",
        nameEn: "Jazz Corner, then the Hip-hop Cellar",
        detail:
          "音乐不投票。先听三首爵士，再沿同一条夜街走八分钟，进入嘻哈场。冲突变成前后顺序。",
      },
      {
        time: "23:15",
        name: "天台双银幕",
        nameEn: "Rooftop Double Screen",
        detail:
          "一块银幕是粉彩旅馆镜头，一块是漫威夜景。谁也没赢下整座城。都会夜生活把两边接在同一段夜里。",
      },
    ],
  },
};
