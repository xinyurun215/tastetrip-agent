# TasteTrip 合味旅行

TasteTrip turns a taste conflict between two people into one reordered trip.

It does not average two profiles into a bland midpoint. It names the **conflicts**, finds the **intersection** both people can stand in, and **reorders** the route around that intersection.

This demo uses **fixed fake data only**. A real [Qloo](https://www.qloo.com/) taste-graph integration is planned and not wired up. No API key is required. Entity images are not included: poster slots are flat color blocks labeled `placeholder`. Real images would come from Qloo entities later.

## The conflict → intersection reorder

| | |
| --- | --- |
| Person A | 《布达佩斯大饭店》 (The Grand Budapest Hotel), jazz, hotpot (火锅) |
| Person B | Marvel, hip-hop, sushi |
| Conflicts | City vibe (城市气质), dining style (用餐方式) |
| Intersection | Urban nightlife (都会夜生活) |
| Reorder | Drop the split daytime plans. Walk one night instead. |

The night route, in order. Each stop is labeled with why both people would like it (fake copy for now, later a Qloo affinity score):

1. **19:30 对称旅馆大堂** — Grand Budapest symmetry, but only after dark.
2. **20:10 双柜台夜食堂** — hotpot and sushi at one counter, not two restaurants.
3. **21:40 爵士转角 → 嘻哈地下室** — jazz first, hip-hop one block later.
4. **23:15 天台双银幕** — pastel hotel frames on one screen, a Marvel skyline on the other.

## What the page looks like

Black page, one typeface, flat color. No photographs.

The first screen is one sentence — 两个人的口味冲突 → 找出重叠 — and a yellow **一键试玩** button. That button loads the fixed pair above.

- **Conflict** is two train-ticket stubs. A is orange, B is blue. Each stub carries three poster-shaped color blocks marked `placeholder` (film, music, food). The torn seam between the stubs is the conflict: 城市气质 and 用餐方式.
- **Intersection** is those stubs pieced back into one acid-yellow itinerary, with a strip of A's orange and B's blue still on the edges. It opens with a short animation after the tear is visible. Every stop has a black label: 为什么两人都喜欢 / Why both will like it.

Changing the six fields and pressing **用这组重排** runs the same local fake rules. **一键试玩** always returns to the original pair.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually [http://localhost:5173](http://localhost:5173). Press **一键试玩**. Conflict and the reordered night route both show within a few seconds.

pnpm works the same way if you prefer it:

```bash
pnpm install
pnpm dev
```

Production build:

```bash
npm run build
npm run preview
```

## Qloo (planned, not connected)

The page never calls Qloo and never prints a secret. When a real key exists later, the intended variable is:

```bash
VITE_QLOO_API_KEY=
```

`.env.example` documents that name with an empty value. Copy it to `.env.local` on your own machine only. Do not commit a real key. `.env` and `.env.local` are gitignored.

The "why both will like it" lines are handwritten fake reasons. They are the slot a Qloo affinity score would fill.

## Placeholders

Taste art is CSS color blocks plus inline SVG ticket edges drawn in this repo. Each block is labeled `placeholder`. This repository does not download or ship posters, covers, or food photos.

## License

MIT. See [LICENSE](LICENSE).
