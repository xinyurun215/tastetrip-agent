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
    has(musicA.value, ["小众爵士", "kamasi"]) &&
    has(workB.value, ["深夜食堂", "midnight diner"]) &&
    has(foodB.value, ["夜宵"])
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
        title: canonical ? "小众爵士的窄房间" : workA.value,
        detail: canonical ? "A 要的是曲子，不是景点，也不是旅馆。" : `A 的画面把城市拉向「${workA.value}」。`,
      },
      b: {
        title: canonical ? "后半夜只剩吃的" : workB.value,
        detail: canonical ? "B 不看演出。夜里只留得下一顿热的。" : `B 的画面把城市拉向「${workB.value}」。`,
      },
    });
  }

  if (norm(foodA.value) !== norm(foodB.value)) {
    conflicts.push({
      index: conflicts.length === 0 ? "01" : "02",
      label: "用餐方式",
      labelEn: "Dining style",
      a: {
        title: canonical ? "吧台边的一杯" : foodA.value,
        detail: canonical ? "吃是附带的，座位要靠着音乐。" : `A 把晚饭交给「${foodA.value}」。`,
      },
      b: {
        title: canonical ? "只要夜宵" : foodB.value,
        detail: canonical ? "不点酒，也不进演出厅。只要还在出餐。" : `B 把晚饭交给「${foodB.value}」。`,
      },
    });
  }

  return stampMock(conflicts);
}
