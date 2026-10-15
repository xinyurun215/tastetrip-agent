const base = `${import.meta.env?.BASE_URL || '/'}album-photos/`;
const hk = {src: `${base}hong-kong.webp`, alt:'香港中环的电车与街口', credit:'Florian Wehde · 香港', source:'https://unsplash.com/photos/DpgujuZ92zE'};
const river = {src:`${base}shanghai-river.webp`,alt:'上海黄浦江畔',credit:'Li Yang · 上海',source:'https://unsplash.com/photos/5h_dMuX_7RE'};
const evening = {src:`${base}shanghai-evening.webp`,alt:'上海入夜的城市灯光',credit:'Freeman Zhou · 上海',source:'https://unsplash.com/photos/oV9hp8wXkPE'};
const ky = {src:`${base}kyoto.webp`,alt:'京都夜晚的街景',credit:'Zhuojun Yu · 京都',source:'https://unsplash.com/photos/iB2hbc0soDM'};

// These are openly licensed editorial samples, never records of the user's travel.
export const SAMPLE_ALBUMS = [
  {sample:true,title:'沿途',subtitle:'街巷与灯火',photos:[hk,ky,river,evening],chapter:'走慢一点',story:'示例片段：\n在街口停一会儿。等电车驶过，等店里的灯亮起来。比起目的地，也想记住这些短短的停留。'},
  {sample:true,title:'上海',subtitle:'江风入夜',photos:[evening,river,evening],chapter:'江的另一边',story:'示例片段：\n天色一点点暗下来，江对岸的灯陆续亮起。走了一天，到这里才想把脚步放慢。'},
  {sample:true,title:'香港',subtitle:'街口的一刻',photos:[hk],chapter:'等一辆电车',story:'示例片段：\n街口响起叮叮声。抬头看招牌，低头看轨道，忽然觉得不必急着去下一站。'},
  {sample:true,title:'京都',subtitle:'灯下慢行',photos:[ky],chapter:'店门还亮着',story:'示例片段：\n晚风穿过街巷，门口还有人在说话。今天的最后一站，就留给这一盏灯。'},
];
