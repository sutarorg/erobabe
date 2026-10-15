let fallback: { id: string; name: string } | undefined;
export function anonymousProfile() {
  if (fallback) return fallback;
  try {
    const stored = JSON.parse(localStorage.getItem("erobabe-anonymous-profile") || "null");
    if (stored && /^[0-9a-f-]{36}$/i.test(stored.id) && /^(Wobbly|Sneaky|Disco|Sleepy|Cosmic|Jolly)(Panda|Potato|Penguin|Pickle|Waffle|Otter)\d{4}$/.test(stored.name)) return (fallback = stored);
  } catch { /* Storage may be disabled. Keep an in-memory identity. */ }
  const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];
  fallback = { id: crypto.randomUUID(), name: pick(["Wobbly", "Sneaky", "Disco", "Sleepy", "Cosmic", "Jolly"]) + pick(["Panda", "Potato", "Penguin", "Pickle", "Waffle", "Otter"]) + String(Math.floor(Math.random() * 10000)).padStart(4, "0") };
  try { localStorage.setItem("erobabe-anonymous-profile", JSON.stringify(fallback)); } catch { /* best effort */ }
  return fallback;
}
