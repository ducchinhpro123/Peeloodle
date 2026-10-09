/** Shared native-control recipes. Keep every utility literal so Tailwind can discover it. */
export const button =
	'button inline-flex [min-block-size:44px] items-center justify-center gap-2 rounded-control border border-control-line bg-surface [padding-inline:16px] [padding-block:11px] text-[14px] font-bold text-ink no-underline disabled:cursor-not-allowed disabled:opacity-60';

export const buttonPrimary =
	'button primary inline-flex [min-block-size:44px] items-center justify-center gap-2 rounded-control border border-transparent bg-primary [padding-inline:16px] [padding-block:11px] text-[14px] font-bold text-white no-underline shadow-[0_3px_0_var(--primary-shadow)] disabled:cursor-not-allowed disabled:opacity-60';

export const buttonDanger =
	'button danger inline-flex [min-block-size:44px] items-center justify-center gap-2 rounded-control border border-danger bg-danger [padding-inline:16px] [padding-block:11px] text-[14px] font-bold text-white no-underline disabled:cursor-not-allowed disabled:opacity-60';

export const buttonIcon =
	'button icon inline-flex [min-block-size:36px] [inline-size:36px] items-center justify-center gap-2 rounded-[9px] border-0 bg-transparent p-2 text-[14px] font-bold text-ink no-underline disabled:cursor-not-allowed disabled:opacity-60';

export const buttonIconLarge =
	'button icon inline-flex [min-block-size:44px] [inline-size:44px] [min-inline-size:44px] items-center justify-center gap-2 rounded-[9px] border-0 bg-transparent p-2 text-[14px] font-bold text-ink no-underline disabled:cursor-not-allowed disabled:opacity-60';
