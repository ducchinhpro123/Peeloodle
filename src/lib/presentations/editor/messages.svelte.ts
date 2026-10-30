/** The one place an editor action reports a refusal or failure in words. */

export type MessageBar = {
	readonly current: string | null;
	show(message: string): void;
	clear(): void;
};

export function createMessages(): MessageBar {
	let current = $state<string | null>(null);
	return {
		get current() {
			return current;
		},
		show(message) {
			current = message;
		},
		clear() {
			current = null;
		}
	};
}
