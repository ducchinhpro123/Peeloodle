/**
 * Orchestration tests for one processing run, with injected dependencies so the
 * contract is checked without a database or a native decoder: the source path
 * comes from the claimed row, the derivative paths are bound to that asset and
 * version, the report's hashes are the real hashes of the derived bytes, and every
 * failure path reports a stable code through the guarded `fail` call.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '$lib/hash';
import { ProcessingError } from './errors';
import { runProcessingJob, type ProcessingDeps, type ProcessingOutcome } from './runJob';
import type { ProcessedAsset } from './index';
import type {
	CatalogAssetVersionReport,
	CatalogRefusal,
	CatalogUploadClaimResult,
	CatalogUploadCompletionResult
} from '../repository';
import type { CatalogUploadJob } from '../types';

const jobId = 'j0000000-0000-4000-8000-000000000001';
const assetId = 'a0000000-0000-4000-8000-000000000001';
const versionId = 'v0000000-0000-4000-8000-000000000009';
const leaseToken = 'l0000000-0000-4000-8000-000000000001';

function job(overrides: Partial<CatalogUploadJob> = {}): CatalogUploadJob {
	return {
		id: jobId,
		batchId: 'b0000000-0000-4000-8000-000000000001',
		assetId,
		sourcePath: 'b0000000-0000-4000-8000-000000000001/s.png',
		originalName: 'Chart 01.PNG',
		claimedMime: 'image/png',
		claimedBytes: 1024,
		position: 0,
		stage: 'claimed',
		progress: 0,
		attempts: 1,
		leaseExpiresAt: '2026-09-16T00:05:00.000Z',
		errorCode: null,
		errorMessage: null,
		createdAt: '2026-09-16T00:00:00.000Z',
		updatedAt: '2026-09-16T00:00:00.000Z',
		...overrides
	};
}

const processed: ProcessedAsset = {
	sourceFormat: 'png',
	sourceBytes: 1024,
	sourceSha256: 'a'.repeat(64),
	width: 512,
	height: 256,
	png: new Uint8Array([1, 2, 3, 4]),
	thumbnail: new Uint8Array([9, 9])
};

type Recorded = {
	claim: unknown[][];
	download: string[];
	upload: unknown[][];
	complete: unknown[][];
	fail: unknown[][];
};

function deps(
	overrides: Partial<ProcessingDeps> & {
		claimResult?: CatalogUploadClaimResult;
		completion?: CatalogUploadCompletionResult;
	} = {}
) {
	const recorded: Recorded = { claim: [], download: [], upload: [], complete: [], fail: [] };
	const claimResult: CatalogUploadClaimResult = overrides.claimResult ?? {
		ok: true,
		item: { job: job(), leaseToken, leaseExpiresAt: '2026-09-16T00:05:00.000Z' }
	};
	const completion: CatalogUploadCompletionResult = overrides.completion ?? {
		ok: true,
		item: { job: job({ stage: 'ready' }), version: {}, replayed: false } as never
	};
	const base: ProcessingDeps = {
		claim: async (id, seconds) => {
			recorded.claim.push([id, seconds]);
			return claimResult;
		},
		downloadSource: async (path) => {
			recorded.download.push(path);
			return new Uint8Array(1024);
		},
		uploadDerivative: async (path, bytes, mime) => {
			recorded.upload.push([path, bytes, mime]);
		},
		complete: async (id, token, report) => {
			recorded.complete.push([id, token, report]);
			return completion;
		},
		fail: async (id, token, error) => {
			recorded.fail.push([id, token, error]);
			return { ok: true, item: job({ stage: 'failed' }) };
		},
		process: async () => processed,
		newVersionId: () => versionId,
		...overrides
	};
	return { deps: base, recorded };
}

describe('runProcessingJob', () => {
	it('claims the requested job, derives it and finalizes under the same lease', async () => {
		const { deps: deps_, recorded } = deps();
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toEqual({
			status: 'processed',
			jobId,
			versionId,
			replayed: false,
			width: 512,
			height: 256,
			sourceFormat: 'png'
		});
		expect(recorded.claim).toEqual([[jobId, 300]]);
		expect(recorded.download).toEqual(['b0000000-0000-4000-8000-000000000001/s.png']);
		expect(recorded.upload.map((call) => call[0])).toEqual([
			`assets/${assetId}/${versionId}/asset.png`,
			`assets/${assetId}/${versionId}/thumb.webp`
		]);
		expect(recorded.upload.map((call) => call[2])).toEqual(['image/png', 'image/webp']);
		const [id, token, report] = recorded.complete[0] as [string, string, CatalogAssetVersionReport];
		expect(id).toBe(jobId);
		expect(token).toBe(leaseToken);
		expect(report.derivativePath).toBe(`assets/${assetId}/${versionId}/asset.png`);
		expect(report.derivativeSha256).toBe(await sha256Hex(processed.png));
		expect(report.thumbnailSha256).toBe(await sha256Hex(processed.thumbnail));
		expect(report.derivativeBytes).toBe(4);
		expect(report.derivativeWidth).toBe(512);
		expect(report.sourceMime).toBe('image/png');
		expect(report.renderer).toBe('sharp+resvg');
		expect(recorded.fail).toEqual([]);
	});

	it('reports a validation failure with its stable code and stores nothing', async () => {
		const { deps: deps_, recorded } = deps({
			process: async () => {
				throw new ProcessingError('svg_unsafe', 'Event handler attribute is not allowed: onload');
			}
		});
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toEqual({
			status: 'failed',
			jobId,
			code: 'svg_unsafe',
			message: 'Event handler attribute is not allowed: onload'
		});
		expect(recorded.complete).toEqual([]);
		expect(recorded.upload).toEqual([]);
		expect(recorded.fail[0]?.[2]).toMatchObject({ code: 'svg_unsafe' });
	});

	it('turns an unreachable source into a retryable source_unavailable failure', async () => {
		const { deps: deps_, recorded } = deps({
			downloadSource: async () => {
				throw new Error('The resource was not found');
			}
		});
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toMatchObject({ status: 'failed', code: 'source_unavailable' });
		expect(recorded.fail[0]?.[2]).toMatchObject({ code: 'source_unavailable' });
	});

	it('records an upload failure instead of finalizing', async () => {
		const { deps: deps_, recorded } = deps({
			uploadDerivative: async () => {
				throw new Error('storage unavailable');
			}
		});
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toMatchObject({ status: 'failed', code: 'upload_failed' });
		expect(recorded.complete).toEqual([]);
	});

	it('propagates a claim refusal without touching the source', async () => {
		const { deps: deps_, recorded } = deps({
			claimResult: { ok: false, reason: 'none_pending' satisfies CatalogRefusal, detail: {} }
		});
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toEqual({ status: 'refused', jobId: undefined, reason: 'none_pending' });
		expect(recorded.download).toEqual([]);
		expect(recorded.fail).toEqual([]);
	});

	it('propagates a lease refusal from finalization without claiming success', async () => {
		const { deps: deps_, recorded } = deps({
			completion: {
				ok: false,
				reason: 'lease_lost',
				detail: { item: job({ stage: 'claimed' }) }
			}
		});
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toEqual({ status: 'refused', jobId, reason: 'lease_lost' });
		expect(recorded.complete).toHaveLength(1);
	});

	it('fails a job that has no asset to record a version against', async () => {
		const { deps: deps_, recorded } = deps({
			claimResult: {
				ok: true,
				item: {
					job: job({ assetId: null }),
					leaseToken,
					leaseExpiresAt: '2026-09-16T00:05:00.000Z'
				}
			}
		});
		const outcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toMatchObject({ status: 'failed', code: 'job_without_asset' });
		expect(recorded.download).toEqual([]);
	});

	it('marks a replay as replayed rather than processing twice', async () => {
		const { deps: deps_ } = deps({
			completion: {
				ok: true,
				item: { job: job({ stage: 'ready' }), version: {} as never, replayed: true }
			}
		});
		const outcome: ProcessingOutcome = await runProcessingJob(deps_, jobId);
		expect(outcome).toMatchObject({ status: 'processed', replayed: true });
	});
});
