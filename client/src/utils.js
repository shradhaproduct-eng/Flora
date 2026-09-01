export const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(value) ? value : 0
  );

// Builds a friendly default name from the flowers currently in the
// arrangement, e.g. "Rose & Tulip Bouquet" or "Rose, Lily & Peony Bouquet".
// Falls back to a timestamped name when nothing is selected yet.
export function generateDefaultName(items) {
  const names = items
    .filter((item) => item.flower_name && Number(item.stems) > 0)
    .sort((a, b) => Number(b.stems) - Number(a.stems))
    .map((item) => item.flower_name);

  if (names.length === 0) {
    return `New Arrangement — ${new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`;
  }

  const unique = [...new Set(names)].slice(0, 3);
  const label =
    unique.length === 1
      ? unique[0]
      : `${unique.slice(0, -1).join(", ")} & ${unique[unique.length - 1]}`;
  return `${label} Bouquet`;
}

export function emptyItem() {
  return { key: crypto.randomUUID(), flower_id: null, flower_name: "", stem_price: 0, stems: 1 };
}
