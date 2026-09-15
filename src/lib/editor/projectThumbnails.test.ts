import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	acquireProjectThumbnail,
	PROJECT_THUMBNAIL_CACHE_SIZE,
	resetProjectThumbnails
} from './projectThumbnails';
import { createMemoryRepository, createProjectDocument } from '../persistence/repository';

let created = 0;
let revoked: string[] = [];

beforeEach(() => {
	// Clear the shared cache first, while the previous test's mock still owns the
	// revocations, so this test only observes what it creates.
	resetProjectThumbnails();
	created = 0;
	revoked = [];
	URL.createObjectURL = vi.fn(() => `blob:thumb-${created++}`);
	URL.revokeObjectURL = vi.fn((url: string) => {
		revoked.push(url);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('project thumbnail cache', () => {
	it('renders once per revision and shares the URL between concurrent callers', async () => {
		const repository = createMemoryRepository();
		const project = createProjectDocument({ id: 'shared-key' });
		const render = vi.fn(async () => new Blob(['thumb']));

		const [first, second] = await Promise.all([
			acquireProjectThumbnail({ repository, project }, render),
			acquireProjectThumbnail({ repository, project }, render)
		]);

		expect(first).toBe('blob:thumb-0');
		expect(second).toBe(first);
		expect(render).toHaveBeenCalledTimes(1);
		expect(revoked).toEqual([]);
	});

	it('renders again for a new revision', async () => {
		const repository = createMemoryRepository();
		const project = createProjectDocument({ id: 'revision-key' });
		const render = vi.fn(async () => new Blob(['thumb']));

		expect(await acquireProjectThumbnail({ repository, project }, render)).toBe('blob:thumb-0');
		const nextRevision = { ...project, revision: project.revision + 1 };
		expect(await acquireProjectThumbnail({ repository, project: nextRevision }, render)).toBe(
			'blob:thumb-1'
		);
		expect(render).toHaveBeenCalledTimes(2);
	});

	it('does not cache a failure', async () => {
		const repository = createMemoryRepository();
		const project = createProjectDocument({ id: 'failure-key' });
		const failing = vi.fn(async () => {
			throw new Error('no canvas');
		});
		const render = vi.fn(async () => new Blob(['thumb']));

		expect(await acquireProjectThumbnail({ repository, project }, failing)).toBeNull();
		expect(await acquireProjectThumbnail({ repository, project }, render)).toBe('blob:thumb-0');
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('revokes the oldest URL exactly once when the cache evicts it', async () => {
		const repository = createMemoryRepository();
		const render = vi.fn(async () => new Blob(['thumb']));
		const urls: string[] = [];

		for (let index = 0; index <= PROJECT_THUMBNAIL_CACHE_SIZE; index += 1) {
			const project = createProjectDocument({ id: `lru-${index}` });
			urls.push((await acquireProjectThumbnail({ repository, project }, render))!);
		}

		expect(revoked).toEqual([urls[0]]);
		expect(revoked).toHaveLength(1);
	});
});
