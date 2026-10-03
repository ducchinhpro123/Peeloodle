/**
 * Lazy export orchestration (P40).
 *
 * PDF and PPTX builders are loaded on demand, so opening the editor never pays
 * for pdf-lib or PptxGenJS. One export runs at a time; its snapshot is always
 * disposed, downloads happen only after the bytes are complete, and cancellation
 * between slides stops the work without producing a partial file.
 *
 * The module list lives in `exports/loaders.ts`: offline readiness warms exactly the
 * builders this controller can reach.
 */

import { NOTHING_UNSAVED, reloadInstruction, type ReloadSafety } from '../offlineReadiness';
import { downloadBlob } from '#lib/exports/download.js';
import {
	backupDocumentFingerprint,
	rememberBackupDownload,
	type BackupDownloadReceipt
} from './backupReceipt';
import type { PresentationRepository } from '../persistence/repository';
import type { PresentationDocument } from '../model/types';
import type { ExportWarning } from '../exports/snapshot';
import type { buildPresentationPdf } from '../exports/pdf';
import type { buildPresentationPptx } from '../exports/pptx';
import type { prepareExportSnapshot } from '../exports/snapshot';
import {
	loadBackupBuilder,
	loadExportSnapshot,
	loadPdfBuilder,
	loadPptxBuilder
} from '../exports/loaders';

export type PresentationExportFormat = 'pdf' | 'pptx' | 'backup';
export type PresentationExportPhase =
	'idle' | 'preparing' | 'rendering' | 'done' | 'failed' | 'cancelled';

export type PresentationExportState = {
	phase: PresentationExportPhase;
	format: PresentationExportFormat | null;
	/** Slides rendered so far, and the total for the running export. */
	completed: number;
	total: number;
	message: string | null;
	warnings: ExportWarning[];
	/** Only set after a restorable snapshot was handed to the browser. */
	backupDownload?: BackupDownloadReceipt;
};

export const IDLE_PRESENTATION_EXPORT: PresentationExportState = {
	phase: 'idle',
	format: null,
	completed: 0,
	total: 0,
	message: null,
	warnings: []
};

/** Seams tests replace so no canvas or download is needed. */
export type PresentationExportOverrides = {
	prepare?: typeof prepareExportSnapshot;
	buildPdf?: typeof buildPresentationPdf;
	buildPptx?: typeof buildPresentationPptx;
	download?: (blob: Blob, filename: string) => void;
};

/**
 * What the export controller needs from its page: the repository it reads media from,
 * the captured document, the open text session's flush, and the editor's write state
 * — a failed export's recovery copy must never tell a student to reload over
 * unwritten work.
 */
export type PresentationExportInput = {
	repository: PresentationRepository;
	/** Reads the live document; the controller flushes text before it does. */
	getDocument: () => PresentationDocument | null;
	flushText: () => void;
	/** Read when an export fails; the controller cannot know what is unwritten. */
	reloadSafety?: () => ReloadSafety;
};

export function exportFileName(title: string, format: PresentationExportFormat): string {
	const base =
		title
			.replace(/[^\p{L}\p{N} _-]/gu, '')
			.trim()
			.slice(0, 60) || 'presentation';
	return format === 'backup' ? `${base}.stickerlab.zip` : `${base}.${format}`;
}

/**
 * The message for a failed export. A builder that could not be fetched is reported
 * as such with reload guidance, because a failed browser module import stays failed
 * for the life of the page — retrying it in the same page cannot work, and the
 * student's saved work is unaffected either way. The reload instruction itself comes
 * from the editor's write state: reloading over unwritten work loses it, and a save
 * that is already failing must not be answered with a reload or a tab close.
 */
export function exportFailureMessage(
	error: unknown,
	safety: ReloadSafety = NOTHING_UNSAVED
): string {
	const message = error instanceof Error ? error.message : '';
	if (/dynamically imported module|module script failed/i.test(message)) {
		return `This export needs a part of the app that could not be loaded. ${reloadInstruction(safety)}`;
	}
	return message || 'The export failed.';
}

const MIME: Record<PresentationExportFormat, string> = {
	pdf: 'application/pdf',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	backup: 'application/zip'
};

export type PresentationExportController = {
	getState: () => PresentationExportState;
	subscribeState: (listener: () => void) => () => void;
	exportDeck: (format: PresentationExportFormat) => Promise<void>;
	cancel: () => void;
	/** Aborts a running export and stops publishing; the page calls it on teardown. */
	destroy: () => void;
};

export function createPresentationExport(
	input: PresentationExportInput & PresentationExportOverrides
): PresentationExportController {
	let state: PresentationExportState = IDLE_PRESENTATION_EXPORT;
	const listeners = new Set<() => void>();
	let mounted = true;
	let running = false;
	let abort: AbortController | null = null;

	const publish = (next: PresentationExportState) => {
		if (!mounted) return;
		state = next;
		for (const listener of listeners) listener();
	};

	const cancel = () => {
		abort?.abort();
	};

	const exportDeck = async (format: PresentationExportFormat): Promise<void> => {
		if (running) return;
		running = true;
		const controller = new AbortController();
		abort = controller;
		publish({ phase: 'preparing', format, completed: 0, total: 0, message: null, warnings: [] });

		let snapshot: Awaited<ReturnType<typeof prepareExportSnapshot>> | null = null;
		try {
			const snapshotModule = await loadExportSnapshot();
			const prepare = input.prepare ?? snapshotModule.prepareExportSnapshot;
			// Capture after the flush so an open text session is part of the snapshot.
			input.flushText();
			const document = input.getDocument();
			if (!document) throw new Error('Open a presentation before exporting.');
			snapshot = await prepare(input.repository, document);
			if (controller.signal.aborted) throw new Error('cancelled');

			const total = snapshot.document.slides.length;
			publish({
				phase: 'rendering',
				format,
				completed: 0,
				total,
				message: null,
				warnings: snapshot.warnings
			});

			let bytes: Uint8Array;
			if (format === 'pdf') {
				const { buildPresentationPdf } = await loadPdfBuilder();
				const buildPdf = input.buildPdf ?? buildPresentationPdf;
				bytes = await buildPdf(snapshot, undefined, {
					signal: controller.signal,
					onProgress: (completed, count) => {
						publish({
							phase: 'rendering',
							format,
							completed,
							total: count,
							message: null,
							warnings: snapshot!.warnings
						});
					}
				});
			} else if (format === 'pptx') {
				const { buildPresentationPptx } = await loadPptxBuilder();
				const buildPptx = input.buildPptx ?? buildPresentationPptx;
				bytes = await buildPptx(snapshot, { title: snapshot.document.title });
				publish({
					phase: 'rendering',
					format,
					completed: total,
					total,
					message: null,
					warnings: snapshot.warnings
				});
			} else {
				const { createBackupArchive } = await loadBackupBuilder();
				const media = new Map(
					[...snapshot.media].map(([assetId, record]) => [assetId, record.bytes])
				);
				bytes = await createBackupArchive(snapshot.document, media);
				publish({
					phase: 'rendering',
					format,
					completed: total,
					total,
					message: null,
					warnings: snapshot.warnings
				});
			}
			if (controller.signal.aborted) throw new Error('cancelled');

			const backupDownload =
				format === 'backup'
					? {
							documentId: snapshot.document.id,
							documentSha256: await backupDocumentFingerprint(snapshot.document),
							downloadedAt: new Date().toISOString()
						}
					: undefined;
			if (controller.signal.aborted) throw new Error('cancelled');
			const download = input.download ?? downloadBlob;
			// Copy through a view: `Uint8Array.buffer` is ArrayBufferLike, which a Blob
			// cannot take, and the bytes are copied either way.
			const blobBytes = new Uint8Array(bytes).slice();
			download(
				new Blob([blobBytes], { type: MIME[format] }),
				exportFileName(snapshot.document.title, format)
			);
			if (backupDownload) rememberBackupDownload(backupDownload);
			publish({
				phase: 'done',
				format,
				completed: total,
				total,
				message: null,
				warnings: snapshot.warnings,
				...(backupDownload ? { backupDownload } : {})
			});
		} catch (error) {
			const wasCancelled =
				controller.signal.aborted || (error instanceof Error && error.message === 'cancelled');
			publish({
				phase: wasCancelled ? 'cancelled' : 'failed',
				format,
				completed: 0,
				total: 0,
				message: wasCancelled
					? 'The export was cancelled.'
					: exportFailureMessage(error, input.reloadSafety?.() ?? NOTHING_UNSAVED),
				warnings: []
			});
		} finally {
			snapshot?.dispose();
			abort = null;
			running = false;
		}
	};

	return {
		getState: () => state,
		subscribeState: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		exportDeck,
		cancel,
		destroy: () => {
			mounted = false;
			abort?.abort();
			listeners.clear();
		}
	};
}
