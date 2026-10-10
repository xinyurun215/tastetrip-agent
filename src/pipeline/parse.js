export const KINDS = [
  { key: "work", label: "作品" },
  { key: "music", label: "音乐" },
  { key: "food", label: "饮食" },
];

export function parseTastes(raw) {
  const a = [0, 1, 2].map((index) => String(raw?.a?.[index] ?? "").trim());
  const b = [0, 1, 2].map((index) => String(raw?.b?.[index] ?? "").trim());
  if ([...a, ...b].some((value) => value.length === 0)) {
    const error = new Error("六项口味都填上之后，才能撕开票根并重排。");
    error.code = "INCOMPLETE";
    throw error;
  }
  const pack = (values) => KINDS.map((kind, index) => ({ ...kind, value: values[index] }));
  return { a: pack(a), b: pack(b) };
}
