# TasteTrip 合味旅行

TasteTrip turns a taste conflict between two people into one reordered trip.

It does not average two profiles into a bland midpoint. It names the **conflicts**, finds the **intersection** both people can stand in, and **reorders** the route around that intersection.

Tonight's demo uses **fixed fake data only**. A real [Qloo](https://www.qloo.com/) taste-graph integration is planned and not wired up. No API key is required.

## The conflict → intersection reorder

| | |
| --- | --- |
| Person A | 《布达佩斯大饭店》 (The Grand Budapest Hotel), jazz, hotpot (火锅) |
| Person B | Marvel, hip-hop, sushi |
| Conflicts | City vibe (城市气质), dining style (用餐方式) |
| Intersection | Urban nightlife (都会夜生活) |
| Reorder | Drop the split daytime plans. Walk one night instead. |

The night route, in order:

1. **19:30 对称旅馆大堂** — Grand Budapest symmetry, but only after dark.
2. **20:10 双柜台夜食堂** — hotpot and sushi at one counter, not two restaurants.
3. **21:40 爵士转角 → 嘻哈地下室** — jazz first, hip-hop one block later.
4. **23:15 天台双银幕** — pastel hotel frames on one screen, a Marvel skyline on the other.

## What the page looks like

One page, two result regions that do not share a layout:

- **Conflict (冲突点)** sits on the cream page. A coral panel for person A faces a blue panel for person B, with a dark **对不上** badge between them. Above the panels, the daytime plans are listed as set aside.
- **Intersection (交集路线)** is a full-width night block: near-black background, gold type, and a single vertical gold timeline. It is not split into A vs B.

Jump links under the title (`冲突点 Conflict` / `交集路线 Intersection`) scroll to each region. The form loads the fixed pair above. Editing the six fields and pressing **用这两人的口味重排** reruns the same local fake rules. **恢复演示数据** puts the original pair back.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually [http://localhost:5173](http://localhost:5173).

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

## License

MIT. See [LICENSE](LICENSE).
