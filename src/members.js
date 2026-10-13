const text = (value) => String(value ?? "").trim();

export function scoreCell(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function buildMembersRequest(members, context = {}) {
  return {
    mode: "members-harness",
    context: { ...context },
    members: (Array.isArray(members) ? members : []).map((member, index) => {
      const constraints = {
        city: text(member.city),
        start: text(member.start),
        time: text(member.time),
        budget: text(member.budget),
        hardRejections: text(member.hardRejections),
        softPreferences: text(member.softPreferences),
      };
      return {
        id: text(member.id) || `member-${index + 1}`,
        name: text(member.name) || `成员 ${index + 1}`,
        preferences: (Array.isArray(member.preferences) ? member.preferences : []).map(text),
        constraints,
        hardRejections: constraints.hardRejections,
        softPreferences: constraints.softPreferences,
      };
    }),
  };
}
