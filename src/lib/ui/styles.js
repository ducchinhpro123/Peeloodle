/** Shared native-control recipes. Keep every utility literal so Tailwind can discover it. */
export const button =
	'button inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-control-line bg-surface px-4 py-[11px] text-[14px] font-bold text-ink no-underline transition-[background,box-shadow,transform] duration-[160ms] ease-in-out hover:bg-[#f0f5f2] hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-60';

export const buttonPrimary =
	'button primary inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-transparent bg-primary px-4 py-[11px] text-[14px] font-bold text-white no-underline shadow-[0_3px_0_var(--primary-shadow)] transition-[background,box-shadow,transform] duration-[160ms] ease-in-out hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_4px_0_var(--primary-hover-shadow)] disabled:cursor-not-allowed disabled:opacity-60';

export const buttonDanger =
	'button danger inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-danger bg-danger px-4 py-[11px] text-[14px] font-bold text-white no-underline transition-[background,box-shadow,transform] duration-[160ms] ease-in-out hover:bg-danger-strong hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-60';

export const buttonIcon =
	'button icon inline-flex min-h-9 w-9 items-center justify-center gap-2 rounded-[9px] border-0 bg-transparent p-2 text-[14px] font-bold text-ink no-underline transition-[background,box-shadow,transform] duration-[160ms] ease-in-out hover:bg-[#f0f5f2] hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-60';

export const buttonIconLarge =
	'button icon inline-flex min-h-11 w-11 min-w-11 items-center justify-center gap-2 rounded-[9px] border-0 bg-transparent p-2 text-[14px] font-bold text-ink no-underline transition-[background,box-shadow,transform] duration-[160ms] ease-in-out hover:bg-[#f0f5f2] hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-60';
