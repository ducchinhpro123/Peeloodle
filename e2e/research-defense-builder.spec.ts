/**
 * Failure modes, before implementation:
 * 1. Extracting helpers changes a shipped deck; the frozen fixture catches it.
 * 2. Lengths omit, duplicate or reorder slides.
 * 3. Section seconds do not sum to the advertised talk time.
 * 4. Document, slide or element IDs collide within or across builds.
 * 5. Personal details land on the wrong elements or retain extra whitespace.
 * 6. Empty optional fields erase useful sample content.
 * 7. Long titles overflow instead of shrinking; fields exceed their limits.
 * 8. Invalid dates leak through or west-of-UTC dates move to the previous day.
 * 9. Look remapping misses a color or font, or midnight changes the sample.
 * 10. On-dark text has insufficient contrast.
 * 11. Generated decks exceed model limits or cannot be parsed by the editor.
 * 12. Time labels misrepresent seconds or Q&A as timed talk content.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	SHIPPED_TEMPLATES,
	SAMPLE_NOTE
} from '../src/lib/presentations/templates/shippedTemplates.js';
import { parsePresentationDocument } from '../src/lib/presentations/model/parse';

const api = () => import('../src/lib/presentations/templates/researchDefense.js');
const lengths = ['short', 'standard', 'extended'] as const;
const looks = ['midnight', 'lab', 'thesis'] as const;
const normalized = (value: unknown) =>
	JSON.parse(
		JSON.stringify(value, (key, item) =>
			['id', 'createdAt', 'updatedAt'].includes(key) ? undefined : item
		)
	);
const paragraphs = (element: any) =>
	element.paragraphs.map((paragraph: any) => paragraph.runs.map((run: any) => run.text).join(''));
const named = (doc: any, slideName: string, elementName: string) =>
	doc.slides
		.find((slide: any) => slide.name === slideName)
		.elements.find((element: any) => element.name === elementName);

test('shipped decks match the frozen fixture', () => {
	const fixture = JSON.parse(
		readFileSync(new URL('./fixtures/shipped-templates.normalized.json', import.meta.url), 'utf8')
	);
	expect(
		normalized(SHIPPED_TEMPLATES.map((template) => ({ key: template.key, doc: template.build() })))
	).toEqual(fixture);
});

test('each length builds its sections in order', async () => {
	const { buildResearchDefenseDeck, DEFENSE_LENGTHS, DEFENSE_SECTIONS } = await api();
	for (const [length, count, names] of [
		[
			'short',
			7,
			['Title', 'Problem', 'Question', 'Method', 'Results image area', 'Discussion', 'Q&A']
		],
		[
			'standard',
			9,
			[
				'Title',
				'Problem',
				'Question',
				'Method',
				'Results image area',
				'Discussion',
				'Limitations',
				'References',
				'Q&A'
			]
		],
		[
			'extended',
			13,
			[
				'Title',
				'Outline',
				'Problem',
				'Background',
				'Question',
				'Method',
				'Results image area',
				'More results',
				'Discussion',
				'Limitations',
				'Conclusion',
				'References',
				'Q&A'
			]
		]
	] as const) {
		const doc = buildResearchDefenseDeck({ length });
		expect(doc.slides).toHaveLength(count);
		expect(doc.slides.map((slide) => slide.name)).toEqual(names);
		expect(doc.slides.map((slide) => slide.name)).toEqual(
			DEFENSE_LENGTHS[length].sections.map(({ section }) => DEFENSE_SECTIONS[section].slideName)
		);
	}
});

test('section seconds sum to the talk length', async () => {
	const { DEFENSE_LENGTHS } = await api();
	for (const [length, seconds] of [
		['short', 600],
		['standard', 900],
		['extended', 1200]
	] as const)
		expect(DEFENSE_LENGTHS[length].sections.reduce((sum, item) => sum + item.seconds, 0)).toBe(
			seconds
		);
});

test('ids are unique within a deck and across builds', async () => {
	const { buildResearchDefenseDeck } = await api();
	const ids = Array.from({ length: 2 }, () =>
		buildResearchDefenseDeck({ length: 'extended' })
	).flatMap((doc) => [
		doc.id,
		...doc.slides.flatMap((slide) => [slide.id, ...slide.elements.map((element) => element.id)])
	]);
	expect(new Set(ids).size).toBe(ids.length);
});

test('personal details land on the title and question slides', async () => {
	const { buildResearchDefenseDeck } = await api();
	const doc = buildResearchDefenseDeck({
		title: '  Light   and\nGrowth ',
		presenter: 'Ana Lim',
		institution: 'Uni X',
		advisor: 'Dr. B',
		date: '2026-12-05',
		question: 'Does light matter?'
	});
	expect(doc.title).toBe('Light and Growth');
	expect(paragraphs(named(doc, 'Title', 'Title'))).toEqual(['Light and Growth']);
	expect(paragraphs(named(doc, 'Title', 'Subtitle'))).toEqual([
		'Ana Lim · Uni X',
		'Advisor: Dr. B',
		'December 5, 2026'
	]);
	expect(named(doc, 'Title', 'Subtitle').height).toBe(144);
	expect(paragraphs(named(doc, 'Question', 'Question body'))).toEqual(['Does light matter?']);
});

test('empty optional fields keep sample text', async () => {
	const { buildResearchDefenseDeck } = await api();
	const doc = buildResearchDefenseDeck({
		title: 'T',
		presenter: '  ',
		institution: '',
		advisor: '\n',
		question: '   '
	});
	expect(paragraphs(named(doc, 'Title', 'Subtitle'))).toEqual([
		'Replace with your title, name and institution'
	]);
	expect(paragraphs(named(doc, 'Question', 'Question body'))[0]).toMatch(
		new RegExp(`^${SAMPLE_NOTE}`)
	);
});

test('long titles shrink and fields clamp', async () => {
	const { buildResearchDefenseDeck, cleanDefenseField } = await api();
	const doc = buildResearchDefenseDeck({
		title: 'A'.repeat(200),
		presenter: 'B'.repeat(100),
		institution: 'C'.repeat(160),
		advisor: 'D'.repeat(100),
		question: 'E'.repeat(320)
	});
	expect(doc.title).toHaveLength(120);
	expect(named(doc, 'Title', 'Title').paragraphs[0].runs[0].size).toBe(48);
	expect(
		named(buildResearchDefenseDeck({ title: 'A'.repeat(60) }), 'Title', 'Title').paragraphs[0]
			.runs[0].size
	).toBe(64);
	expect(paragraphs(named(doc, 'Title', 'Subtitle'))).toEqual([
		`${'B'.repeat(80)} · ${'C'.repeat(120)}`,
		`Advisor: ${'D'.repeat(80)}`
	]);
	expect(paragraphs(named(doc, 'Question', 'Question body'))[0]).toHaveLength(280);
	expect(cleanDefenseField('  a\n b\t c ', 4)).toBe('a b ');
});

test('invalid dates are dropped', async () => {
	const { formatDefenseDate } = await api();
	for (const date of ['2026-02-30', 'tomorrow', '2026-13-01', '2026-2-05', '2025-02-29', ''])
		expect(formatDefenseDate(date)).toBe('');
	const previous = process.env.TZ;
	try {
		process.env.TZ = 'Pacific/Honolulu';
		expect(formatDefenseDate('2026-12-05')).toBe('December 5, 2026');
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test('looks remap every colour and font', async () => {
	const { buildResearchDefenseDeck } = await api();
	const doc = buildResearchDefenseDeck({ look: 'thesis' });
	for (const old of ['#0b1f3b', '#08b879', '#e8f4ee', '#bfe9d6'])
		expect(JSON.stringify(doc)).not.toContain(old);
	for (const slide of doc.slides)
		for (const element of slide.elements)
			if (element.kind === 'text')
				for (const paragraph of element.paragraphs)
					for (const run of paragraph.runs) expect(run.fontId).toBe('spectral');
	expect(normalized(buildResearchDefenseDeck({ look: 'midnight' }))).toEqual(
		normalized(buildResearchDefenseDeck())
	);
});

test('on-dark text meets 4.5:1 on every look', async () => {
	const { DEFENSE_LOOKS } = await api();
	const luminance = (hex: string) => {
		const [r, g, b] = hex
			.slice(1)
			.match(/../g)!
			.map((byte) => {
				const n = parseInt(byte, 16) / 255;
				return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
			});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	for (const look of Object.values(DEFENSE_LOOKS))
		expect((luminance(look.onDark) + 0.05) / (luminance(look.dark) + 0.05)).toBeGreaterThanOrEqual(
			4.5
		);
});

test('decks stay inside presentation limits', async () => {
	const { buildResearchDefenseDeck } = await api();
	for (const length of lengths)
		for (const look of looks) {
			const doc = buildResearchDefenseDeck({ length, look, title: 'A'.repeat(120) });
			expect(() => parsePresentationDocument(JSON.stringify(doc))).not.toThrow();
			expect(doc.slides.length).toBeLessThanOrEqual(50);
			expect(doc.title.length).toBeLessThanOrEqual(300);
			expect(doc.assets).toEqual([]);
			for (const slide of doc.slides) {
				expect(slide.elements.length).toBeLessThanOrEqual(200);
				for (const element of slide.elements)
					if (element.kind === 'text')
						expect(paragraphs(element).join('').length).toBeLessThanOrEqual(20_000);
			}
		}
});

test('formatSectionTime', async () => {
	const { formatSectionTime } = await api();
	for (const [seconds, label] of [
		[0, 'after the talk'],
		[30, '~30 s'],
		[60, '~1 min'],
		[150, '~2.5 min']
	] as const)
		expect(formatSectionTime(seconds)).toBe(label);
});

test.afterAll(async ({}, info) => {
	writeFileSync(
		info.outputPath('shipped-deck-verification.json'),
		JSON.stringify(
			normalized(
				SHIPPED_TEMPLATES.map((template) => ({ key: template.key, doc: template.build() }))
			),
			null,
			2
		)
	);
});
