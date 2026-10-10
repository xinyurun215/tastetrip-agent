# Qloo fixtures

These payloads are **illustrative**. No Qloo API key was available, so they are not a captured live response and not a measured bake-off.

They follow the public search and insights shapes:

- Search: `results[]` with `entity_id`, `name`, `type` (`urn:entity:*`), `properties`, `popularity`, `tags`, and `query.affinity`.
- Insights: `results.entities[]` with the same fields. Place insights use `urn:entity:place`.

`demo-pair.json` is the fixed TasteTrip pair (Person A 《布达佩斯大饭店》 / 爵士 Jazz / 火锅, Person B Marvel / 嘻哈 Hip-hop / 寿司).

- `searches` is one search response per taste. `query.affinity` here is only how well the hit matches the query (high).
- `insights.cross` is an insights response for those same entities. Its `query.affinity` is the cross-person score (low). The app uses this number for conflict copy.
- `insights.demo` is the place insights response. Stop order follows these affinities.
- `insights.generic` is the place list for any other taste pair, so an edited pair still does not fall through to the handwritten itinerary.

An empty server key replays this file and tags the page `qloo:replay` (entity records also carry `qloo:entity`). A configured production key calls the live API and must tag `qloo:entity` only: no `mock:fixture`, no `qloo:replay`.
