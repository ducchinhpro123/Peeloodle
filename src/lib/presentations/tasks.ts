export type PresentationTask = 'class' | 'research-defense' | 'club-pitch';
export type GalleryCategory = 'all' | 'class' | 'research' | 'pitch' | 'business';

export const GALLERY_CATEGORIES: readonly { slug: GalleryCategory; label: string }[] = [
	{ slug: 'all', label: 'All templates' },
	{ slug: 'class', label: 'Class' },
	{ slug: 'research', label: 'Research' },
	{ slug: 'pitch', label: 'Pitch' },
	{ slug: 'business', label: 'Business' }
];

export function parsePresentationTask(search: string): PresentationTask | null {
	const task = new URLSearchParams(search).get('task');
	return task === 'class' || task === 'research-defense' || task === 'club-pitch' ? task : null;
}

export function categoryForUseCase(useCase: string): GalleryCategory | null {
	switch (useCase) {
		case 'class':
			return 'class';
		case 'research-defense':
			return 'research';
		case 'club-pitch':
			return 'pitch';
		case 'company-profile':
			return 'business';
		default:
			return null;
	}
}

export function galleryCategoryFromSearch(search: string): GalleryCategory {
	const value = new URLSearchParams(search).get('category');
	const explicit = GALLERY_CATEGORIES.find(({ slug }) => slug === value);
	if (explicit) return explicit.slug;
	const task = parsePresentationTask(search);
	return task ? (categoryForUseCase(task) ?? 'all') : 'all';
}
