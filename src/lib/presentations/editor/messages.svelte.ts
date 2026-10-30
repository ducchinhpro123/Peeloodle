/** The one place an editor action reports a refusal or failure in words. */

export type MessageBar = {
	readonly current: string | null;
	show(message: string): void;
	clear(): void;
	/** A neutral note (saved, inserted, reload guidance), shown apart from errors. */
	readonly notice: string | null;
	showNotice(message: string): void;
	clearNotice(): void;
};

export function createMessages(): MessageBar {
	let current = $state<string | null>(null);
	let notice = $state<string | null>(null);
	return {
		get current() {
			return current;
		},
		show(message) {
			current = message;
		},
		clear() {
			current = null;
		},
		get notice() {
			return notice;
		},
		showNotice(message) {
			notice = message;
		},
		clearNotice() {
			notice = null;
		}
	};
}
