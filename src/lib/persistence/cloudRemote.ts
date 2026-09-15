/**
 * The Supabase remote for private cloud work (ported from the source
 * `cloudRemote.ts`).
 *
 * Wire contract kept exactly: owner-scoped `projects`/`packs` rows read with
 * `select('id,document,revision,deleted')`, one `project_binaries` row per
 * immutable binary, a private `stickerlab-private` Storage bucket whose object
 * path is `<ownerId>/<sha256>`, and the existing `commit_sticker_resource` RPC
 * for conflict-checked commits. No schema, policy or backend change is added by
 * the target; the server side is reused as-is.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/cloud/database';
import { blobBytes } from '$lib/blob';
import { sha256Hex } from '$lib/hash';
import type { ProjectDocument } from '$lib/domain/domain';
import type { AssetRecord, MaskRecord } from './repository';
import { parseAsset, parsePackRecord, parseProjectDocument } from './repository';
import type {
	BinaryReference,
	CommitResult,
	PendingOperation,
	RemoteResource,
	ResourceKind,
	SyncEntry
} from './syncTypes';
import { validateUpload } from '$lib/assets/validateUpload';

const BUCKET = 'stickerlab-private';

export type RemoteBundle = {
	resource: RemoteResource;
	assets: AssetRecord[];
	masks: MaskRecord[];
};

export interface CloudRemote {
	warnings?: string[];
	list(kind: ResourceKind): Promise<RemoteResource[]>;
	download(resource: RemoteResource): Promise<RemoteBundle>;
	commit(
		entry: SyncEntry,
		operation: PendingOperation,
		assets: AssetRecord[],
		masks: MaskRecord[]
	): Promise<CommitResult>;
}

export async function binaryHash(blob: Blob): Promise<string> {
	return sha256Hex(await blobBytes(blob));
}

function parseResource(value: unknown): RemoteResource {
	if (!value || typeof value !== 'object') throw new Error('Invalid cloud resource');
	const raw = value as Record<string, unknown>;
	if (
		(raw.kind !== 'project' && raw.kind !== 'pack') ||
		typeof raw.id !== 'string' ||
		typeof raw.revision !== 'number' ||
		!Number.isSafeInteger(raw.revision) ||
		raw.revision < 1 ||
		typeof raw.deleted !== 'boolean'
	)
		throw new Error('Invalid cloud revision');
	const document =
		raw.kind === 'project' ? parseProjectDocument(raw.value) : parsePackRecord(raw.value);
	if (document.id !== raw.id) throw new Error('Cloud identity mismatch');
	return {
		kind: raw.kind,
		id: raw.id,
		revision: raw.revision,
		deleted: raw.deleted,
		value: document
	};
}

export class SupabaseRemote implements CloudRemote {
	warnings: string[] = [];

	constructor(
		private readonly client: SupabaseClient<Database>,
		private readonly ownerId: string
	) {}

	async list(kind: ResourceKind): Promise<RemoteResource[]> {
		const resources: RemoteResource[] = [];
		for (let offset = 0; ; offset += 100) {
			const { data, error } = await this.client
				.from(kind === 'project' ? 'projects' : 'packs')
				.select('id,document,revision,deleted')
				.order('id')
				.range(offset, offset + 99);
			if (error) throw error;
			for (const row of data) {
				try {
					resources.push(
						parseResource({
							kind,
							id: row.id,
							value: row.document,
							revision: row.revision,
							deleted: row.deleted
						})
					);
				} catch {
					const warning = `An unreadable cloud ${kind} was skipped. Other work is available; contact the maintainer to recover that record.`;
					if (!this.warnings.includes(warning)) this.warnings.push(warning);
				}
			}
			if (data.length < 100) return resources;
		}
	}

	async download(resource: RemoteResource): Promise<RemoteBundle> {
		const assets: AssetRecord[] = [];
		const masks: MaskRecord[] = [];
		if (resource.kind !== 'project' || resource.deleted) return { resource, assets, masks };
		const { data, error } = await this.client
			.from('project_binaries')
			.select('kind,logical_key,hash,metadata')
			.eq('project_id', resource.id);
		if (error) throw error;
		// Bounded sequential binary work avoids decoding hundreds of 25MP images at once.
		for (const row of data) {
			if (!/^[a-f0-9]{64}$/.test(row.hash)) throw new Error('Invalid cloud image identity');
			const { data: blob, error: downloadError } = await this.client.storage
				.from(BUCKET)
				.download(`${this.ownerId}/${row.hash}`);
			if (downloadError) throw downloadError;
			if ((await binaryHash(blob)) !== row.hash)
				throw new Error('Cloud image is corrupt; local work was kept');
			const decoded = await validateUpload(new File([blob], 'cloud-image', { type: blob.type }));
			if (row.kind === 'asset') {
				const asset = parseAsset(row.metadata);
				if (
					asset.id !== row.logical_key ||
					asset.width !== decoded.width ||
					asset.height !== decoded.height ||
					asset.mimeType !== decoded.mimeType
				)
					throw new Error('Cloud image metadata does not match its bytes');
				assets.push({ asset, blob });
			} else if (row.kind === 'mask') {
				if (decoded.mimeType !== 'image/png') throw new Error('Cloud mask must be PNG');
				masks.push({ key: row.logical_key, blob });
			} else throw new Error('Invalid cloud binary type');
		}
		const document = resource.value as ProjectDocument;
		if (
			document.assetIds.some((id) => !assets.some((asset) => asset.asset.id === id)) ||
			document.layers.some(
				(layer) =>
					layer.kind === 'image' &&
					layer.maskKey &&
					!masks.some((mask) => mask.key === layer.maskKey)
			)
		)
			throw new Error('Cloud sticker is incomplete; local work was kept');
		// Detect a document/references race instead of caching mixed revisions.
		const { data: current, error: readError } = await this.client
			.from('projects')
			.select('revision')
			.eq('id', resource.id)
			.single();
		if (readError) throw readError;
		if (current.revision !== resource.revision)
			throw new Error('Cloud sticker changed during download. Refresh to retry.');
		return { resource, assets, masks };
	}

	async commit(
		entry: SyncEntry,
		operation: PendingOperation,
		assets: AssetRecord[],
		masks: MaskRecord[]
	): Promise<CommitResult> {
		const binaries: BinaryReference[] = [];
		const uploads = [
			...assets.map(({ asset, blob }) => ({
				key: asset.id,
				kind: 'asset' as const,
				metadata: {
					id: asset.id,
					mimeType: asset.mimeType,
					width: asset.width,
					height: asset.height,
					blobKey: asset.blobKey,
					provenance: asset.provenance
				},
				blob
			})),
			...masks.map(({ key, blob }) => ({ key, kind: 'mask' as const, metadata: {}, blob }))
		];
		for (const upload of uploads) {
			const hash = await binaryHash(upload.blob);
			const path = `${this.ownerId}/${hash}`;
			const { error } = await this.client.storage.from(BUCKET).upload(path, upload.blob, {
				upsert: false,
				contentType: upload.blob.type || 'image/png'
			});
			if (error && !('statusCode' in error && String(error.statusCode) === '409')) throw error;
			const { data, error: verifyError } = await this.client.storage.from(BUCKET).download(path);
			if (verifyError) throw verifyError;
			if ((await binaryHash(data)) !== hash) throw new Error('Cloud upload verification failed');
			binaries.push({ key: upload.key, kind: upload.kind, hash, metadata: upload.metadata });
		}
		const { data, error } = await this.client.rpc('commit_sticker_resource', {
			operation_id: operation.operationId,
			resource_kind: entry.kind,
			resource_id: entry.id,
			expected_revision: entry.baseRevision,
			body: operation.value,
			binaries: binaries as Json
		});
		if (error) throw error;
		if (
			!data ||
			typeof data !== 'object' ||
			Array.isArray(data) ||
			typeof data.conflict !== 'boolean'
		)
			throw new Error('Invalid cloud acknowledgment');
		return {
			resource: parseResource(data.resource),
			original: data.original ? parseResource(data.original) : undefined,
			conflict: data.conflict
		};
	}
}
