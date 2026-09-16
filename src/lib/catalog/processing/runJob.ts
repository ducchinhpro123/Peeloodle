/**
 * One claimed job, end to end: claim, download the reserved source, validate and
 * derive with `processAssetBytes`, store the immutable derivatives, finalize.
 *
 * Everything is injected so the same code runs against the Supabase repository
 * (the route) and against fakes (tests). Failures are reported through the guarded
 * `fail` RPC with the processing error's stable code, so the dashboard can show a
 * real reason and offer a retry.
 */
import type {
	CatalogActionResult,
	CatalogAssetVersionReport,
	CatalogRefusal,
	CatalogUploadClaimResult,
	CatalogUploadCompletionResult
} from '../repository';
import type { CatalogUploadJob } from '../types';
import { sha256Hex } from '$lib/hash';
import { isProcessingError } from './errors';
import type { ProcessedAsset } from './index';

export type ProcessingDeps = {
	claim: (jobId: string, leaseSeconds?: number) => Promise<CatalogUploadClaimResult>;
	downloadSource: (path: string) => Promise<Uint8Array>;
	uploadDerivative: (path: string, bytes: Blob, mime: 'image/png' | 'image/webp') => Promise<void>;
	complete: (
		jobId: string,
		leaseToken: string,
		report: CatalogAssetVersionReport
	) => Promise<CatalogUploadCompletionResult>;
	fail: (
		jobId: string,
		leaseToken: string,
		error: { code: string; message: string }
	) => Promise<CatalogActionResult<CatalogUploadJob>>;
	/** Overridable so tests do not need a native decoder. */
	process?: (bytes: Uint8Array) => Promise<ProcessedAsset>;
	/** Overridable so tests get deterministic derivative paths. */
	newVersionId?: () => string;
};

export type ProcessingOutcome =
	| {
			status: 'processed';
			jobId: string;
			versionId: string;
			replayed: boolean;
			width: number;
			height: number;
			sourceFormat: ProcessedAsset['sourceFormat'];
	  }
	| { status: 'none' }
	| { status: 'failed'; jobId: string; code: string; message: string }
	| { status: 'refused'; jobId?: string; reason: CatalogRefusal };

export const PROCESSING_LEASE_SECONDS = 300;

function messageOf(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export async function runProcessingJob(
	deps: ProcessingDeps,
	jobId: string
): Promise<ProcessingOutcome> {
	const claim = await deps.claim(jobId, PROCESSING_LEASE_SECONDS);
	if (!claim.ok) return { status: 'refused', jobId: claim.detail.item?.id, reason: claim.reason };
	const { job, leaseToken } = claim.item;
	if (!job.assetId) {
		// A batch job always names its draft asset; without one there is nowhere to
		// record a version, so this is a real failure rather than a silent skip.
		const failed = await deps.fail(job.id, leaseToken, {
			code: 'job_without_asset',
			message: 'The upload job is not attached to a catalog asset'
		});
		return failed.ok
			? {
					status: 'failed',
					jobId: job.id,
					code: 'job_without_asset',
					message: failed.item.errorMessage ?? ''
				}
			: { status: 'refused', jobId: job.id, reason: failed.reason };
	}

	// The native decoder is imported lazily so this module stays browser-safe for
	// the in-memory repository's fake processor.
	const process = deps.process ?? (await import('./index')).processAssetBytes;
	let processed: ProcessedAsset;
	try {
		const bytes = await deps.downloadSource(job.sourcePath);
		processed = await process(bytes);
	} catch (error) {
		const code = isProcessingError(error) ? error.code : 'source_unavailable';
		const message = messageOf(error, 'The source file could not be processed');
		const failed = await deps.fail(job.id, leaseToken, { code, message });
		return failed.ok
			? { status: 'failed', jobId: job.id, code, message }
			: { status: 'refused', jobId: job.id, reason: failed.reason };
	}

	const versionId = (deps.newVersionId ?? (() => crypto.randomUUID()))();
	const prefix = `assets/${job.assetId}/${versionId}`;
	const derivativePath = `${prefix}/asset.png`;
	const thumbnailPath = `${prefix}/thumb.webp`;
	const report: CatalogAssetVersionReport = {
		versionId,
		sourceSha256: processed.sourceSha256,
		sourceBytes: processed.sourceBytes,
		sourceMime: job.claimedMime,
		derivativePath,
		derivativeSha256: await sha256Hex(processed.png),
		derivativeBytes: processed.png.length,
		derivativeMime: 'image/png',
		derivativeWidth: processed.width,
		derivativeHeight: processed.height,
		thumbnailPath,
		thumbnailSha256: await sha256Hex(processed.thumbnail),
		thumbnailBytes: processed.thumbnail.length,
		renderer: 'sharp+resvg',
		validation: {
			source_format: processed.sourceFormat,
			output: 'png+webp-thumbnail',
			limits: 'processing/limits.ts'
		}
	};

	try {
		await deps.uploadDerivative(
			derivativePath,
			new Blob([processed.png as unknown as BlobPart]),
			'image/png'
		);
		await deps.uploadDerivative(
			thumbnailPath,
			new Blob([processed.thumbnail as unknown as BlobPart]),
			'image/webp'
		);
	} catch (error) {
		const message = messageOf(error, 'The derivative could not be stored');
		const failed = await deps.fail(job.id, leaseToken, { code: 'upload_failed', message });
		return failed.ok
			? { status: 'failed', jobId: job.id, code: 'upload_failed', message }
			: { status: 'refused', jobId: job.id, reason: failed.reason };
	}

	const completed = await deps.complete(job.id, leaseToken, report);
	if (!completed.ok) return { status: 'refused', jobId: job.id, reason: completed.reason };
	return {
		status: 'processed',
		jobId: job.id,
		versionId,
		replayed: completed.item.replayed,
		width: processed.width,
		height: processed.height,
		sourceFormat: processed.sourceFormat
	};
}
