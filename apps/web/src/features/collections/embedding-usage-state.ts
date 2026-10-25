export const embeddingUsageKey = (project: string, collection: string) =>
  [
    "workbench",
    "project",
    project,
    "collection",
    collection,
    "embedding-usage",
  ] as const;

export function estimatedEmbeddingCost(value: string | null): string {
  if (value === null || !value.trim()) return "Cost unavailable";
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || value.trim().startsWith("-"))
    return "Cost unavailable";
  const underflow =
    number === 0 && /[1-9]/.test(value.toLowerCase().split("e")[0]);
  if (underflow || (number > 0 && number < 0.00000001))
    return "Estimate < $0.00000001";
  return `Estimate ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(number)}`;
}
