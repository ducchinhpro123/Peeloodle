import {
	SAMPLE_NOTE,
	HEADING,
	BODY,
	DARK,
	ACCENT,
	PANEL,
	ON_DARK,
	WHITE,
	makeTheme,
	makeDocument,
	textBox,
	bulletBox,
	shapeBox,
	imagePlaceholder,
	slide,
	titled
} from './deckParts.js';

/** @typedef {'short'|'standard'|'extended'} DefenseLength */
/** @typedef {'midnight'|'lab'|'thesis'} DefenseLook */
/** @typedef {'title'|'outline'|'problem'|'background'|'question'|'method'|'results'|'moreResults'|'discussion'|'limitations'|'conclusion'|'references'|'qa'} DefenseSection */
/** @typedef {{ length?: DefenseLength, look?: DefenseLook, title?: string, presenter?: string, institution?: string, advisor?: string, date?: string, question?: string }} DefenseDeckOptions */

/** @type {Record<DefenseLength, { label: string, minutes: number, sections: { section: DefenseSection, seconds: number }[] }>} */
export const DEFENSE_LENGTHS = {
	short: {
		label: '10 minutes · 7 slides',
		minutes: 10,
		sections: [
			{ section: 'title', seconds: 30 },
			{ section: 'problem', seconds: 90 },
			{ section: 'question', seconds: 60 },
			{ section: 'method', seconds: 150 },
			{ section: 'results', seconds: 150 },
			{ section: 'discussion', seconds: 120 },
			{ section: 'qa', seconds: 0 }
		]
	},
	standard: {
		label: '15 minutes · 9 slides',
		minutes: 15,
		sections: [
			{ section: 'title', seconds: 30 },
			{ section: 'problem', seconds: 120 },
			{ section: 'question', seconds: 60 },
			{ section: 'method', seconds: 180 },
			{ section: 'results', seconds: 210 },
			{ section: 'discussion', seconds: 180 },
			{ section: 'limitations', seconds: 90 },
			{ section: 'references', seconds: 30 },
			{ section: 'qa', seconds: 0 }
		]
	},
	extended: {
		label: '20 minutes · 13 slides',
		minutes: 20,
		sections: [
			{ section: 'title', seconds: 30 },
			{ section: 'outline', seconds: 30 },
			{ section: 'problem', seconds: 120 },
			{ section: 'background', seconds: 120 },
			{ section: 'question', seconds: 60 },
			{ section: 'method', seconds: 210 },
			{ section: 'results', seconds: 180 },
			{ section: 'moreResults', seconds: 150 },
			{ section: 'discussion', seconds: 150 },
			{ section: 'limitations', seconds: 60 },
			{ section: 'conclusion', seconds: 60 },
			{ section: 'references', seconds: 30 },
			{ section: 'qa', seconds: 0 }
		]
	}
};

/** @type {Record<DefenseSection, { label: string, slideName: string, hint: string }>} */
export const DEFENSE_SECTIONS = {
	title: { label: 'Title', slideName: 'Title', hint: 'Your title, your name, your institution.' },
	outline: {
		label: 'Outline',
		slideName: 'Outline',
		hint: 'Where the talk is going, in one glance.'
	},
	problem: {
		label: 'Problem',
		slideName: 'Problem',
		hint: "What's wrong or missing, and why it matters."
	},
	background: {
		label: 'Background',
		slideName: 'Background',
		hint: 'What others found, and the gap you fill.'
	},
	question: {
		label: 'Question',
		slideName: 'Question',
		hint: 'One sentence the whole talk answers.'
	},
	method: {
		label: 'Method',
		slideName: 'Method',
		hint: 'How you collected and analyzed the data.'
	},
	results: {
		label: 'Results',
		slideName: 'Results image area',
		hint: 'What you found — shown, not told.'
	},
	moreResults: {
		label: 'More results',
		slideName: 'More results',
		hint: 'The second finding, or the detail behind the first.'
	},
	discussion: {
		label: 'Discussion',
		slideName: 'Discussion',
		hint: 'What the results mean for your question.'
	},
	limitations: {
		label: 'Limitations',
		slideName: 'Limitations',
		hint: "What your study can't claim, and what's next."
	},
	conclusion: {
		label: 'Conclusion',
		slideName: 'Conclusion',
		hint: 'Your contribution in three lines.'
	},
	references: {
		label: 'References',
		slideName: 'References',
		hint: 'The sources you cite on your slides.'
	},
	qa: { label: 'Q&A', slideName: 'Q&A', hint: 'Close and invite questions.' }
};

/** @type {Record<DefenseLook, { label: string, dark: string, accent: string, panel: string, onDark: string, headingFontId: string, bodyFontId: string }>} */
export const DEFENSE_LOOKS = {
	midnight: {
		label: 'Midnight',
		dark: '#0b1f3b',
		accent: '#08b879',
		panel: '#e8f4ee',
		onDark: '#bfe9d6',
		headingFontId: 'spectral',
		bodyFontId: 'be-vietnam-pro'
	},
	lab: {
		label: 'Lab notebook',
		dark: '#123b3a',
		accent: '#f2a541',
		panel: '#fdf3e3',
		onDark: '#f6d9a8',
		headingFontId: 'be-vietnam-pro',
		bodyFontId: 'be-vietnam-pro'
	},
	thesis: {
		label: 'Thesis',
		dark: '#3b1f2b',
		accent: '#b8860b',
		panel: '#f5efe6',
		onDark: '#ead8c0',
		headingFontId: 'spectral',
		bodyFontId: 'spectral'
	}
};

export const DEFENSE_FIELD_LIMITS = {
	title: 120,
	presenter: 80,
	institution: 120,
	advisor: 80,
	question: 280
};

/** @param {string | undefined} value @param {number} max */
export function cleanDefenseField(value, max) {
	return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/** @param {string} value */
export function formatDefenseDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(year, month - 1, day);
	// Date's constructor treats 0–99 as 1900–1999; restore the calendar year.
	date.setFullYear(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
		return '';
	return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(date);
}

/** @param {number} seconds */
export function formatSectionTime(seconds) {
	return seconds === 0 ? 'after the talk' : seconds < 60 ? `~${seconds} s` : `~${seconds / 60} min`;
}

/** @param {{section: DefenseSection, seconds: number}[]} sections @returns {import('../model/types').Slide} */
function outlineSection(sections) {
	return titled(
		'Outline',
		WHITE,
		'Outline',
		bulletBox({
			name: 'Outline list',
			lines: sections
				.filter(({ section }) => section !== 'title' && section !== 'qa')
				.map(({ section }) => DEFENSE_SECTIONS[section].label),
			x: 72,
			y: 208,
			width: 1136,
			height: 440,
			size: 24
		})
	);
}

/** @returns {import('../model/types').Slide} */
function backgroundSection() {
	return slide({
		name: 'Background',
		background: WHITE,
		elements: [
			...titled('Background', WHITE, 'Background', null).elements,
			textBox({
				name: 'Previous research',
				text: `${SAMPLE_NOTE} Summarize what others found.`,
				x: 72,
				y: 208,
				width: 536,
				height: 420,
				size: 28
			}),
			textBox({
				name: 'Research gap',
				text: `${SAMPLE_NOTE} Explain the gap your study fills.`,
				x: 672,
				y: 208,
				width: 536,
				height: 420,
				size: 28
			})
		]
	});
}

/** @returns {import('../model/types').Slide} */
function moreResultsSection() {
	const result = resultsSection();
	result.name = 'More results';
	const heading = result.elements.find((element) => element.name === 'Results heading');
	if (heading?.kind === 'text') heading.paragraphs[0].runs[0].text = 'More results';
	return result;
}

/** @returns {import('../model/types').Slide} */
function conclusionSection() {
	return titled(
		'Conclusion',
		WHITE,
		'Conclusion',
		bulletBox({
			name: 'Conclusion list',
			lines: ['Your contribution', 'Why it matters', 'What comes next'],
			x: 72,
			y: 208,
			width: 1136,
			height: 420,
			size: 28
		})
	);
}

/** @param {unknown} value @param {Record<string, string>} replacements @returns {unknown} */
function remap(value, replacements) {
	if (typeof value === 'string') return replacements[value] ?? value;
	if (Array.isArray(value)) return value.map((item) => remap(item, replacements));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, remap(item, replacements)])
		);
	return value;
}

/**
 * Conservative average glyph advance, in em, for the two shipped fonts. The
 * builder runs in Node (the catalog seed imports it) and has no canvas to measure
 * with, so it wraps the title at this width — the same estimate the editor's
 * measurement module falls back to — and sizes the box from the line count. Real
 * fonts are narrower, so the box ends up roomy rather than clipped.
 */
const TITLE_CHAR_EM = 0.55;

/**
 * The sample title box is sized for one line. A personalised title wraps, so the
 * box grows to the lines it needs and the subtitle moves below it; without a
 * personalised title the shipped geometry stays exactly as frozen.
 * @param {import('../model/types').TextElement} element @param {string} text @param {number} size
 */
function fittedTitleHeight(element, text, size) {
	const unit = size * TITLE_CHAR_EM;
	const max = element.width - element.padding * 2;
	// A token wider than the box wraps character by character, like the renderer.
	const widths = text.split(' ').flatMap((word) => {
		const chunks = [];
		let rest = word.length * unit;
		while (rest > max) {
			chunks.push(max);
			rest -= max;
		}
		chunks.push(rest);
		return chunks;
	});
	let lines = 1;
	let used = 0;
	for (const width of widths) {
		const advance = used === 0 ? 0 : unit;
		if (used > 0 && used + advance + width > max) {
			lines += 1;
			used = width;
		} else used += advance + width;
	}
	return Math.ceil(lines * size * element.lineHeight) + element.padding * 2;
}

/** @param {DefenseDeckOptions} [options] @returns {import('../model/types').PresentationDocument} */
export function buildResearchDefenseDeck(options = {}) {
	const length = DEFENSE_LENGTHS[options.length ?? 'standard'];
	const look = DEFENSE_LOOKS[options.look ?? 'midnight'];
	/** @type {Record<DefenseSection, (sections: typeof length.sections) => import('../model/types').Slide>} */
	const builders = {
		title: titleSection,
		outline: outlineSection,
		problem: problemSection,
		background: backgroundSection,
		question: questionSection,
		method: methodSection,
		results: resultsSection,
		moreResults: moreResultsSection,
		discussion: discussionSection,
		limitations: limitationsSection,
		conclusion: conclusionSection,
		references: referencesSection,
		qa: qaSection
	};
	const document = makeDocument(
		'Research defense — sample',
		makeTheme(HEADING, BODY, WHITE),
		length.sections.map(({ section }) => builders[section](length.sections))
	);
	const title = cleanDefenseField(options.title, DEFENSE_FIELD_LIMITS.title);
	const presenter = cleanDefenseField(options.presenter, DEFENSE_FIELD_LIMITS.presenter);
	const institution = cleanDefenseField(options.institution, DEFENSE_FIELD_LIMITS.institution);
	const advisor = cleanDefenseField(options.advisor, DEFENSE_FIELD_LIMITS.advisor);
	const question = cleanDefenseField(options.question, DEFENSE_FIELD_LIMITS.question);
	const date = formatDefenseDate((options.date ?? '').trim());
	const lines = [
		[presenter, institution].filter(Boolean).join(' · '),
		advisor ? `Advisor: ${advisor}` : '',
		date
	].filter(Boolean);
	if (title) document.title = title;
	for (const section of document.slides)
		for (const element of section.elements) {
			if (element.kind !== 'text') continue;
			if (section.name === 'Title' && element.name === 'Title' && title) {
				element.paragraphs[0].runs[0].text = title;
				element.paragraphs[0].runs[0].size = title.length > 60 ? 48 : 64;
			}
			if (section.name === 'Title' && element.name === 'Subtitle' && lines.length) {
				element.paragraphs = lines.map((text) => ({
					...element.paragraphs[0],
					runs: [{ ...element.paragraphs[0].runs[0], text }]
				}));
				element.height = 64 + 40 * (lines.length - 1);
			}
			if (section.name === 'Question' && element.name === 'Question body' && question)
				element.paragraphs[0].runs[0].text = question;
		}
	const titleSlide = document.slides.find((section) => section.name === 'Title');
	const titleBox = titleSlide?.elements.find((element) => element.name === 'Title');
	const subtitleBox = titleSlide?.elements.find((element) => element.name === 'Subtitle');
	if (title && titleBox?.kind === 'text') {
		const size = title.length > 60 ? 48 : 64;
		titleBox.height = fittedTitleHeight(titleBox, title, size);
		if (subtitleBox) subtitleBox.y = titleBox.y + titleBox.height + 16;
	}
	return /** @type {import('../model/types').PresentationDocument} */ (
		remap(document, {
			[DARK]: look.dark,
			[ACCENT]: look.accent,
			[PANEL]: look.panel,
			[ON_DARK]: look.onDark,
			[HEADING]: look.headingFontId,
			[BODY]: look.bodyFontId
		})
	);
}

/** @returns {import('../model/types').Slide} */
function titleSection() {
	return slide({
		name: 'Title',
		background: DARK,
		elements: [
			textBox({
				name: 'Title',
				text: 'Sample: Research defense',
				x: 96,
				y: 220,
				width: 1088,
				height: 150,
				size: 64,
				fontId: HEADING,
				color: WHITE,
				bold: true
			}),
			textBox({
				name: 'Subtitle',
				text: 'Replace with your title, name and institution',
				x: 96,
				y: 380,
				width: 1088,
				height: 64,
				size: 28,
				color: '#bfe9d6'
			})
		]
	});
}

/** @returns {import('../model/types').Slide} */
function problemSection() {
	return slide({
		name: 'Problem',
		background: WHITE,
		elements: [
			...titled('Problem', WHITE, 'Problem', null).elements,
			textBox({
				name: 'Problem body',
				text: `${SAMPLE_NOTE} State the problem and why it matters.`,
				x: 72,
				y: 208,
				width: 1136,
				height: 220,
				size: 28
			}),
			bulletBox({
				name: 'Problem points',
				lines: ['Gap one', 'Gap two'],
				x: 72,
				y: 440,
				width: 1136,
				height: 180,
				size: 26
			})
		]
	});
}

/** @returns {import('../model/types').Slide} */
function questionSection() {
	return titled(
		'Question',
		WHITE,
		'Research question',
		textBox({
			name: 'Question body',
			text: `${SAMPLE_NOTE} One clear research question.`,
			x: 72,
			y: 240,
			width: 1136,
			height: 180,
			size: 36,
			bold: true,
			alignment: 'center',
			verticalAlign: 'middle'
		})
	);
}

/** @returns {import('../model/types').Slide} */
function methodSection() {
	return slide({
		name: 'Method',
		background: WHITE,
		elements: [
			...titled('Method', WHITE, 'Method', null).elements,
			shapeBox({
				name: 'Method 1',
				shape: 'rounded-rectangle',
				x: 72,
				y: 224,
				width: 328,
				height: 328,
				fill: PANEL
			}),
			shapeBox({
				name: 'Method 2',
				shape: 'rounded-rectangle',
				x: 476,
				y: 224,
				width: 328,
				height: 328,
				fill: PANEL
			}),
			shapeBox({
				name: 'Method 3',
				shape: 'rounded-rectangle',
				x: 880,
				y: 224,
				width: 328,
				height: 328,
				fill: PANEL
			}),
			textBox({
				name: 'Method 1 label',
				text: 'Data',
				x: 72,
				y: 340,
				width: 328,
				height: 56,
				size: 30,
				bold: true,
				alignment: 'center'
			}),
			textBox({
				name: 'Method 2 label',
				text: 'Process',
				x: 476,
				y: 340,
				width: 328,
				height: 56,
				size: 30,
				bold: true,
				alignment: 'center'
			}),
			textBox({
				name: 'Method 3 label',
				text: 'Analysis',
				x: 880,
				y: 340,
				width: 328,
				height: 56,
				size: 30,
				bold: true,
				alignment: 'center'
			})
		]
	});
}

/** @returns {import('../model/types').Slide} */
function resultsSection() {
	return slide({
		name: 'Results image area',
		background: WHITE,
		elements: [
			...titled('Results', WHITE, 'Results', null).elements,
			...imagePlaceholder({
				name: 'Results figure',
				x: 72,
				y: 200,
				width: 700,
				height: 420,
				label: 'Results figure placeholder — insert a chart or table image'
			}),
			bulletBox({
				name: 'Results notes',
				lines: ['Finding one', 'Finding two', 'Finding three'],
				x: 812,
				y: 208,
				width: 396,
				height: 400,
				size: 24
			})
		]
	});
}

/** @returns {import('../model/types').Slide} */
function discussionSection() {
	return titled(
		'Discussion',
		WHITE,
		'Discussion',
		textBox({
			name: 'Discussion body',
			text: `${SAMPLE_NOTE} Interpret the results and connect them to the question.`,
			x: 72,
			y: 208,
			width: 1136,
			height: 420,
			size: 28
		})
	);
}

/** @returns {import('../model/types').Slide} */
function limitationsSection() {
	return titled(
		'Limitations',
		PANEL,
		'Limitations',
		bulletBox({
			name: 'Limitations list',
			lines: ['Limitation one', 'Limitation two', 'What you would do next'],
			x: 72,
			y: 208,
			width: 1136,
			height: 420,
			size: 26
		})
	);
}

/** @returns {import('../model/types').Slide} */
function referencesSection() {
	return titled(
		'References',
		WHITE,
		'References',
		bulletBox({
			name: 'References list',
			lines: [
				'Author, A. (2026). Sample reference one.',
				'Author, B. (2025). Sample reference two.'
			],
			x: 72,
			y: 208,
			width: 1136,
			height: 420,
			size: 24
		})
	);
}

/** @returns {import('../model/types').Slide} */
function qaSection() {
	return slide({
		name: 'Q&A',
		background: DARK,
		elements: [
			textBox({
				name: 'Q&A heading',
				text: 'Questions & answers',
				x: 96,
				y: 280,
				width: 1088,
				height: 120,
				size: 56,
				fontId: HEADING,
				color: WHITE,
				bold: true,
				alignment: 'center'
			}),
			textBox({
				name: 'Q&A body',
				text: 'Thank you for your time.',
				x: 96,
				y: 420,
				width: 1088,
				height: 64,
				size: 26,
				color: '#bfe9d6',
				alignment: 'center'
			})
		]
	});
}
