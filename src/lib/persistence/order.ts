/**
 * Newest first, id as the stable tie-breaker. One order for every local
 * library, so the memory and IndexedDB adapters of a repository can never list
 * the same rows differently.
 */
export function byUpdatedAtDescending<T extends { id: string; updatedAt: string }>(
	left: T,
	right: T
): number {
	if (left.updatedAt < right.updatedAt) return 1;
	if (left.updatedAt > right.updatedAt) return -1;
	return left.id.localeCompare(right.id);
}
