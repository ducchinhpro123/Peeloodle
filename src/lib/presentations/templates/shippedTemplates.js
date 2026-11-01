/**
 * The three shipped presentation templates (P72–P74).
 *
 * Plain JavaScript (JSDoc-typed) so both the app and `supabase/seed-template-catalog.mjs`
 * can import the same documents. Each template is a complete, editable
 * `PresentationDocument`: 16:9 slides built from ordinary text and shapes, with
 * no catalog assets, so cloning downloads nothing and every layout is editable.
 * Text is obviously sample content, and image areas are shapes labelled as
 * placeholders — never a promise of native chart or data editing.
 */

import {
	buildCompanyProfileTemplate,
	loadCompanyProfileArtwork
} from './companyProfileTemplate.js';

import {
	SAMPLE_NOTE,
	HEADING,
	BODY,
	ACCENT,
	PANEL,
	WHITE,
	DARK,
	makeTheme,
	textBox,
	bulletBox,
	shapeBox,
	imagePlaceholder,
	slide,
	titled,
	makeDocument
} from './deckParts.js';
export { SAMPLE_NOTE } from './deckParts.js';
import { buildResearchDefenseDeck } from './researchDefense.js';

/**
 * Class presentation: nine layouts for a lecture or seminar.
 * @returns {import('../model/types').PresentationDocument}
 */
function classPresentation() {
	const theme = makeTheme(HEADING, BODY, WHITE);
	const slides = [
		slide({
			name: 'Title',
			background: DARK,
			elements: [
				textBox({
					name: 'Title',
					text: 'Sample: Class presentation',
					x: 96,
					y: 200,
					width: 1088,
					height: 160,
					size: 68,
					fontId: HEADING,
					color: WHITE,
					bold: true
				}),
				textBox({
					name: 'Subtitle',
					text: 'Bài trình bày mẫu · Replace this line with your name and course',
					x: 96,
					y: 372,
					width: 1088,
					height: 64,
					size: 28,
					color: '#bfe9d6'
				}),
				shapeBox({
					name: 'Accent',
					shape: 'ellipse',
					x: 1080,
					y: 120,
					width: 120,
					height: 120,
					fill: ACCENT,
					opacity: 0.9
				})
			]
		}),
		titled(
			'Agenda',
			WHITE,
			'Agenda',
			bulletBox({
				name: 'Agenda list',
				lines: [
					'Concept and motivation',
					'Core idea',
					'Example and comparison',
					'Summary and references'
				],
				x: 72,
				y: 208,
				width: 1136,
				height: 420,
				size: 30
			})
		),
		slide({
			name: 'Concept',
			background: WHITE,
			elements: [
				...titled('Concept', WHITE, 'Concept', null).elements,
				textBox({
					name: 'Concept body',
					text: `${SAMPLE_NOTE} Explain the central idea in two or three short sentences, then support it with the panel on the right.`,
					x: 72,
					y: 208,
					width: 640,
					height: 360,
					size: 28
				}),
				shapeBox({
					name: 'Concept panel',
					shape: 'rounded-rectangle',
					x: 760,
					y: 208,
					width: 448,
					height: 360,
					fill: PANEL
				})
			]
		}),
		slide({
			name: 'Text & image',
			background: WHITE,
			elements: [
				textBox({
					name: 'Heading',
					text: 'Text & image',
					x: 72,
					y: 48,
					width: 1136,
					height: 100,
					size: 52,
					fontId: HEADING,
					bold: true
				}),
				textBox({
					name: 'Body',
					text: `${SAMPLE_NOTE} Keep the paragraph on the left short and let the image carry the detail.`,
					x: 72,
					y: 208,
					width: 560,
					height: 360,
					size: 28
				}),
				...imagePlaceholder({ name: 'Layout image', x: 680, y: 208, width: 528, height: 360 })
			]
		}),
		slide({
			name: 'Comparison',
			background: WHITE,
			elements: [
				textBox({
					name: 'Heading',
					text: 'Comparison',
					x: 72,
					y: 48,
					width: 1136,
					height: 100,
					size: 52,
					fontId: HEADING,
					bold: true
				}),
				shapeBox({
					name: 'Left panel',
					shape: 'rounded-rectangle',
					x: 72,
					y: 200,
					width: 536,
					height: 400,
					fill: PANEL
				}),
				shapeBox({
					name: 'Right panel',
					shape: 'rounded-rectangle',
					x: 672,
					y: 200,
					width: 536,
					height: 400,
					fill: '#fdf1dc'
				}),
				textBox({
					name: 'Left title',
					text: 'Option A',
					x: 104,
					y: 232,
					width: 472,
					height: 56,
					size: 32,
					bold: true
				}),
				textBox({
					name: 'Left body',
					text: `${SAMPLE_NOTE} Two short lines.`,
					x: 104,
					y: 304,
					width: 472,
					height: 240,
					size: 24
				}),
				textBox({
					name: 'Right title',
					text: 'Option B',
					x: 704,
					y: 232,
					width: 472,
					height: 56,
					size: 32,
					bold: true
				}),
				textBox({
					name: 'Right body',
					text: `${SAMPLE_NOTE} Two short lines.`,
					x: 704,
					y: 304,
					width: 472,
					height: 240,
					size: 24
				})
			]
		}),
		slide({
			name: 'Example',
			background: WHITE,
			elements: [
				...titled('Example', WHITE, 'Example', null).elements,
				shapeBox({
					name: 'Example panel',
					shape: 'rounded-rectangle',
					x: 72,
					y: 200,
					width: 1136,
					height: 400,
					fill: '#0f2f4a'
				}),
				textBox({
					name: 'Example body',
					text: `${SAMPLE_NOTE} Walk through one concrete example step by step.`,
					x: 120,
					y: 264,
					width: 1040,
					height: 120,
					size: 34,
					color: WHITE
				}),
				textBox({
					name: 'Example detail',
					text: 'Step 1 → Step 2 → Step 3',
					x: 120,
					y: 420,
					width: 1040,
					height: 80,
					size: 28,
					color: '#bfe9d6'
				})
			]
		}),
		titled(
			'Summary',
			PANEL,
			'Summary',
			bulletBox({
				name: 'Summary list',
				lines: ['Main takeaway one', 'Main takeaway two', 'Main takeaway three'],
				x: 72,
				y: 208,
				width: 1136,
				height: 420,
				size: 30
			})
		),
		titled(
			'References',
			WHITE,
			'References',
			bulletBox({
				name: 'References list',
				lines: [
					'Author, A. (2026). Sample reference one.',
					'Author, B. (2025). Sample reference two.',
					'Author, C. (2024). Sample reference three.'
				],
				x: 72,
				y: 208,
				width: 1136,
				height: 420,
				size: 24
			})
		),
		slide({
			name: 'Closing',
			background: DARK,
			elements: [
				textBox({
					name: 'Closing heading',
					text: 'Thank you',
					x: 96,
					y: 240,
					width: 1088,
					height: 120,
					size: 64,
					fontId: HEADING,
					color: WHITE,
					bold: true,
					alignment: 'center'
				}),
				textBox({
					name: 'Closing body',
					text: 'Questions? Replace this line with your contact details.',
					x: 96,
					y: 380,
					width: 1088,
					height: 72,
					size: 28,
					color: '#bfe9d6',
					alignment: 'center'
				})
			]
		})
	];
	return makeDocument('Class presentation — sample', theme, slides);
}

/**
 * Research defense: eight layouts for a thesis or project defense.
 * @returns {import('../model/types').PresentationDocument}
 */
/**
 * Club pitch: eight layouts for a student club or project pitch.
 * @returns {import('../model/types').PresentationDocument}
 */
function clubPitch() {
	const theme = makeTheme(HEADING, BODY, WHITE);
	const slides = [
		slide({
			name: 'Mission',
			background: DARK,
			elements: [
				textBox({
					name: 'Mission heading',
					text: 'Sample: Club pitch',
					x: 96,
					y: 180,
					width: 1088,
					height: 140,
					size: 64,
					fontId: HEADING,
					color: WHITE,
					bold: true
				}),
				textBox({
					name: 'Mission statement',
					text: 'Our mission in one sentence — replace this sample line.',
					x: 96,
					y: 340,
					width: 1088,
					height: 120,
					size: 32,
					color: '#bfe9d6'
				})
			]
		}),
		titled(
			'Problem',
			WHITE,
			'Problem',
			textBox({
				name: 'Problem body',
				text: `${SAMPLE_NOTE} Describe the problem your club or project addresses.`,
				x: 72,
				y: 208,
				width: 1136,
				height: 420,
				size: 28
			})
		),
		titled(
			'Proposal',
			WHITE,
			'Proposal',
			bulletBox({
				name: 'Proposal list',
				lines: ['What we will do', 'Who it is for', 'Why it works'],
				x: 72,
				y: 208,
				width: 1136,
				height: 420,
				size: 28
			})
		),
		slide({
			name: 'Activities',
			background: WHITE,
			elements: [
				...titled('Activities', WHITE, 'Activities', null).elements,
				shapeBox({
					name: 'Activity 1',
					shape: 'rounded-rectangle',
					x: 72,
					y: 216,
					width: 536,
					height: 180,
					fill: PANEL
				}),
				shapeBox({
					name: 'Activity 2',
					shape: 'rounded-rectangle',
					x: 672,
					y: 216,
					width: 536,
					height: 180,
					fill: PANEL
				}),
				shapeBox({
					name: 'Activity 3',
					shape: 'rounded-rectangle',
					x: 72,
					y: 428,
					width: 536,
					height: 180,
					fill: PANEL
				}),
				shapeBox({
					name: 'Activity 4',
					shape: 'rounded-rectangle',
					x: 672,
					y: 428,
					width: 536,
					height: 180,
					fill: PANEL
				}),
				textBox({
					name: 'Activity 1 label',
					text: 'Workshop',
					x: 104,
					y: 280,
					width: 472,
					height: 56,
					size: 28,
					bold: true,
					alignment: 'center'
				}),
				textBox({
					name: 'Activity 2 label',
					text: 'Meetup',
					x: 704,
					y: 280,
					width: 472,
					height: 56,
					size: 28,
					bold: true,
					alignment: 'center'
				}),
				textBox({
					name: 'Activity 3 label',
					text: 'Competition',
					x: 104,
					y: 492,
					width: 472,
					height: 56,
					size: 28,
					bold: true,
					alignment: 'center'
				}),
				textBox({
					name: 'Activity 4 label',
					text: 'Showcase',
					x: 704,
					y: 492,
					width: 472,
					height: 56,
					size: 28,
					bold: true,
					alignment: 'center'
				})
			]
		}),
		slide({
			name: 'Timeline',
			background: WHITE,
			elements: [
				...titled('Timeline', WHITE, 'Timeline', null).elements,
				shapeBox({
					name: 'Timeline line',
					shape: 'line',
					x: 96,
					y: 380,
					width: 1088,
					height: 4,
					stroke: ACCENT,
					strokeWidth: 4
				}),
				shapeBox({
					name: 'Milestone 1',
					shape: 'ellipse',
					x: 160,
					y: 344,
					width: 72,
					height: 72,
					fill: ACCENT
				}),
				shapeBox({
					name: 'Milestone 2',
					shape: 'ellipse',
					x: 480,
					y: 344,
					width: 72,
					height: 72,
					fill: ACCENT
				}),
				shapeBox({
					name: 'Milestone 3',
					shape: 'ellipse',
					x: 800,
					y: 344,
					width: 72,
					height: 72,
					fill: ACCENT
				}),
				shapeBox({
					name: 'Milestone 4',
					shape: 'ellipse',
					x: 1112,
					y: 344,
					width: 72,
					height: 72,
					fill: ACCENT
				}),
				textBox({
					name: 'Milestone 1 label',
					text: 'Week 1',
					x: 120,
					y: 440,
					width: 152,
					height: 48,
					size: 22,
					alignment: 'center'
				}),
				textBox({
					name: 'Milestone 2 label',
					text: 'Week 4',
					x: 440,
					y: 440,
					width: 152,
					height: 48,
					size: 22,
					alignment: 'center'
				}),
				textBox({
					name: 'Milestone 3 label',
					text: 'Week 8',
					x: 760,
					y: 440,
					width: 152,
					height: 48,
					size: 22,
					alignment: 'center'
				}),
				textBox({
					name: 'Milestone 4 label',
					text: 'Week 12',
					x: 1072,
					y: 440,
					width: 152,
					height: 48,
					size: 22,
					alignment: 'center'
				})
			]
		}),
		slide({
			name: 'Team',
			background: WHITE,
			elements: [
				...titled('Team', WHITE, 'Team', null).elements,
				shapeBox({
					name: 'Member 1',
					shape: 'ellipse',
					x: 152,
					y: 248,
					width: 200,
					height: 200,
					fill: PANEL
				}),
				shapeBox({
					name: 'Member 2',
					shape: 'ellipse',
					x: 540,
					y: 248,
					width: 200,
					height: 200,
					fill: PANEL
				}),
				shapeBox({
					name: 'Member 3',
					shape: 'ellipse',
					x: 928,
					y: 248,
					width: 200,
					height: 200,
					fill: PANEL
				}),
				textBox({
					name: 'Member 1 label',
					text: 'Name\nRole',
					x: 152,
					y: 470,
					width: 200,
					height: 80,
					size: 22,
					alignment: 'center'
				}),
				textBox({
					name: 'Member 2 label',
					text: 'Name\nRole',
					x: 540,
					y: 470,
					width: 200,
					height: 80,
					size: 22,
					alignment: 'center'
				}),
				textBox({
					name: 'Member 3 label',
					text: 'Name\nRole',
					x: 928,
					y: 470,
					width: 200,
					height: 80,
					size: 22,
					alignment: 'center'
				})
			]
		}),
		titled(
			'Impact',
			PANEL,
			'Impact',
			bulletBox({
				name: 'Impact list',
				lines: ['Impact one', 'Impact two', 'Impact three'],
				x: 72,
				y: 208,
				width: 1136,
				height: 420,
				size: 28
			})
		),
		slide({
			name: 'Call to action',
			background: DARK,
			elements: [
				textBox({
					name: 'Call to action',
					text: 'Join us',
					x: 96,
					y: 260,
					width: 1088,
					height: 120,
					size: 60,
					fontId: HEADING,
					color: WHITE,
					bold: true,
					alignment: 'center'
				}),
				textBox({
					name: 'Contact',
					text: 'Replace this line with a sign-up link or contact address.',
					x: 96,
					y: 400,
					width: 1088,
					height: 64,
					size: 26,
					color: '#bfe9d6',
					alignment: 'center'
				})
			]
		})
	];
	return makeDocument('Club pitch — sample', theme, slides);
}

export const SHIPPED_TEMPLATES = [
	{
		key: 'class',
		title: 'Class presentation',
		useCase: 'class',
		description:
			'A nine-slide class deck: title, agenda, concept, text & image, comparison, example, summary, references and closing. All text is sample content.',
		tags: ['class', 'starter'],
		sortOrder: 1,
		build: classPresentation
	},
	{
		key: 'research-defense',
		title: 'Research defense',
		useCase: 'research-defense',
		description:
			'A nine-slide defense deck: title, problem, research question, method, results image area, discussion, limitations, references and Q&A.',
		tags: ['research', 'defense'],
		sortOrder: 2,
		build: () => buildResearchDefenseDeck()
	},
	{
		key: 'club-pitch',
		title: 'Club pitch',
		useCase: 'club-pitch',
		description:
			'An eight-slide club pitch: mission, problem, proposal, activities, timeline, team, impact and call to action.',
		tags: ['club', 'pitch'],
		sortOrder: 3,
		build: clubPitch
	},
	{
		key: 'company-profile',
		title: 'Red & white company profile',
		useCase: 'company-profile',
		description:
			'Adapted from your 15-slide PowerPoint. Text is editable; geometric artwork, photos and charts are flattened into locked image layers. Fonts are approximated.',
		tags: ['business', 'company-profile'],
		sortOrder: 4,
		build: buildCompanyProfileTemplate,
		loadArtwork: loadCompanyProfileArtwork
	}
];

export default SHIPPED_TEMPLATES;
