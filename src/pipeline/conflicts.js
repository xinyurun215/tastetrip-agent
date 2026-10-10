function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function has(value, keys) {
  const text = norm(value);
  return keys.some((key) => text.includes(norm(key)));
}

export function isCanonicalPair(parsed) {
  const [workA, musicA, foodA] = parsed.a;
  const [workB, musicB, foodB] = parsed.b;
  return (
    has(workA.value, ["布达佩斯", "budapest"]) &&
    has(musicA.value, ["爵士", "jazz"]) &&
    has(foodA.value, ["火锅", "hotpot", "hot pot"]) &&
    has(workB.value, ["marvel", "漫威"]) &&
    has(musicB.value, ["hip-hop", "hiphop", "嘻哈"]) &&
    has(foodB.value, ["寿司", "sushi"])
  );
}

function byKey(side, key) {
  return side.find((item) => item.key === key);
}

function stampMock(conflicts) {
  return conflicts.map((conflict) => ({
    ...conflict,
    sourceTag: conflict.sourceTag || "mock:fixture",
  }));
}

export function detectConflicts(parsed, insight) {
  if (insight?.fromQloo) return insight.tensions || [];
  if (insight?.tensions?.length) return stampMock(insight.tensions);

  const canonical = isCanonicalPair(parsed);
  const conflicts = [];
  const workA = byKey(parsed.a, "work");
  const workB = byKey(parsed.b, "work");
  const foodA = byKey(parsed.a, "food");
  const foodB = byKey(parsed.b, "food");

  if (norm(workA.value) !== norm(workB.value)) {
    conflicts.push({
      index: "01",
      label: "城市气质",
      labelEn: "City vibe",
      a: {
        title: canonical ? "粉彩对称的旧世界" : workA.value,
        detail: canonical
          ? "《布达佩斯大饭店》的步调是缓慢、对称、暖色。"
          : `A 的画面把城市拉向「${workA.value}」。`,
      },
      b: {
        title: canonical ? "霓虹巨型都会" : workB.value,
        detail: canonical
          ? "Marvel 要高楼、速度，和亮到过头的夜。"
          : `B 的画面把城市拉向「${workB.value}」。`,
      },
    });
  }

  if (norm(foodA.value) !== norm(foodB.value)) {
    conflicts.push({
      index: conflicts.length === 0 ? "01" : "02",
      label: "用餐方式",
      labelEn: "Dining style",
      a: {
        title: canonical ? "围坐分享的火锅" : foodA.value,
        detail: canonical ? "一只锅、一桌人、一起下筷子。" : `A 把晚饭交给「${foodA.value}」。`,
      },
      b: {
        title: canonical ? "台前精确的寿司" : foodB.value,
        detail: canonical ? "一份一份，看厨师的手。" : `B 把晚饭交给「${foodB.value}」。`,
      },
    });
  }

  return stampMock(conflicts);
}
