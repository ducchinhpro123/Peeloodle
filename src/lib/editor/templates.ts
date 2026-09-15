import type { Layer, ProjectDocument, Template, Transform } from '../domain/domain';
import { ILLUSTRATIONS } from '../assets/illustrations';
import { TEMPLATE_PHOTOS, TEMPLATE_PHOTO_SIZE } from '../assets/templatePhotos';
import { ingestBundledImage } from '../assets/assetLoader';

export const TEMPLATE_CATEGORIES = [
	'All Templates',
	'Trending',
	'Cute Animals',
	'Meme Reactions',
	'Birthday',
	'Love',
	'Work',
	'Text Stickers',
	'Emotions',
	'Seasonal'
] as const;

type Layout =
	| 'orbit'
	| 'big-type'
	| 'stacked-scrapbook'
	| 'sleepy-night'
	| 'polaroid'
	| 'speech-bubble'
	| 'party-burst'
	| 'love-note'
	| 'work-stamp'
	| 'caption-bottom'
	| 'corner-cluster'
	| 'seasonal-sun';

type Pose = { x: number; y: number; scale: number; rotation: number };

type SpecLayer = {
	role: 'decoration' | 'accent';
	asset: string;
	x: number;
	y: number;
	scale: number;
	rotation: number;
};

type Spec = {
	title: string;
	category: Exclude<(typeof TEMPLATE_CATEGORIES)[number], 'All Templates'>;
	layout: Layout;
	text: string;
	font: string;
	color: string;
	photoAsset: (typeof TEMPLATE_PHOTOS)[number]['id'];
	photo: Pose;
	layers: SpecLayer[];
	glasses: boolean;
	captionPaper: boolean;
	fontSize: number;
	paper?: Omit<Pose, 'scale'> & { scale: number };
	caption?: { x: number; y: number; rotation: number };
};

const STICKER_LABELS: Record<string, string> = {
	'04-winking-smiley': 'Winking smiley',
	'05-mint-sparkle-top': 'Mint sparkle',
	'06-sunglasses': 'Sunglasses',
	'07-yellow-sparkle': 'Yellow sparkle',
	'08-mint-sparkle-right': 'Little mint sparkle',
	'10-sleeping-cat': 'Sleepy cat',
	'11-paw-print': 'Paw print',
	'12-small-pink-heart': 'Little heart',
	'13-love-cats': 'Love cats bubble',
	'16-rainbow': 'Rainbow',
	'17-yellow-star': 'Yellow star',
	'20-shooting-star': 'Shooting star',
	'22-green-sprout': 'Green sprout',
	'23-twinkles': 'Twinkles',
	'24-blue-fish': 'Blue fish',
	'25-purple-heart': 'Purple heart'
};

const ILLUSTRATION_BY_ID = new Map(ILLUSTRATIONS.map((item) => [item.id, item]));
const PHOTO_BY_ID = new Map(TEMPLATE_PHOTOS.map((item) => [item.id, item]));
/** Illustrations are 1024px; treat spec scale as ~280px visual size. */
const ILLUSTRATION_SCALE = 280 / 1024;
/** Spec photo.scale is relative to the old 344px cat; stand-ins are 1024px. */
const PHOTO_SCALE = 344 / TEMPLATE_PHOTO_SIZE;

const specs: Spec[] = [
	{
		title: 'Orbit Pop',
		category: 'Trending',
		layout: 'orbit',
		text: 'WILD CARD',
		font: 'Bangers',
		color: '#087ca7',
		photoAsset: 'waving-cat',
		photo: { x: 250, y: 215, scale: 1.55, rotation: -3 },
		layers: [
			{ role: 'decoration', asset: '20-shooting-star', x: 720, y: 145, scale: 0.85, rotation: 19 },
			{ role: 'accent', asset: '24-blue-fish', x: 135, y: 610, scale: 0.95, rotation: -14 },
			{ role: 'accent', asset: '08-mint-sparkle-right', x: 745, y: 690, scale: 0.8, rotation: 7 }
		],
		glasses: false,
		captionPaper: true,
		fontSize: 54,
		paper: { x: 318, y: 792, scale: 0.5, rotation: 4 }
	},
	{
		title: 'Nope Energy',
		category: 'Trending',
		layout: 'big-type',
		text: 'PLOT TWIST',
		font: 'Luckiest Guy',
		color: '#db2777',
		photoAsset: 'thumbs-up',
		photo: { x: 565, y: 415, scale: 0.95, rotation: 7 },
		layers: [
			{ role: 'decoration', asset: '04-winking-smiley', x: 660, y: 150, scale: 1.1, rotation: 12 },
			{ role: 'accent', asset: '17-yellow-star', x: 145, y: 700, scale: 1, rotation: -16 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 108,
		caption: { x: 70, y: 150, rotation: -8 }
	},
	{
		title: 'Tiny Win',
		category: 'Trending',
		layout: 'stacked-scrapbook',
		text: 'TINY WIN',
		font: 'Fredoka',
		color: '#00875e',
		photoAsset: 'boba-tea',
		photo: { x: 155, y: 215, scale: 1.45, rotation: -7 },
		layers: [
			{ role: 'decoration', asset: 'little-rocket', x: 625, y: 355, scale: 1.15, rotation: 13 },
			{ role: 'accent', asset: '22-green-sprout', x: 150, y: 700, scale: 0.9, rotation: -10 },
			{ role: 'accent', asset: '23-twinkles', x: 720, y: 170, scale: 0.75, rotation: 5 }
		],
		glasses: false,
		captionPaper: true,
		fontSize: 64,
		paper: { x: 175, y: 655, scale: 0.76, rotation: -8 }
	},
	{
		title: 'Low Battery',
		category: 'Trending',
		layout: 'sleepy-night',
		text: 'LOW BATTERY',
		font: 'Chewy',
		color: '#7c3aed',
		photoAsset: 'coffee-days',
		photo: { x: 275, y: 260, scale: 1.35, rotation: 2 },
		layers: [
			{ role: 'decoration', asset: 'happy-planet', x: 650, y: 150, scale: 1, rotation: 8 },
			{ role: 'accent', asset: '10-sleeping-cat', x: 155, y: 640, scale: 0.9, rotation: -7 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 58,
		caption: { x: 250, y: 800, rotation: -3 }
	},
	{
		title: 'Pet Bestie',
		category: 'Cute Animals',
		layout: 'polaroid',
		text: 'BESTIE ALERT',
		font: 'Baloo 2',
		color: '#df1688',
		photoAsset: 'sunny-corgi',
		photo: { x: 235, y: 175, scale: 1.4, rotation: -6 },
		layers: [
			{ role: 'decoration', asset: '11-paw-print', x: 675, y: 675, scale: 1, rotation: 18 },
			{ role: 'accent', asset: '24-blue-fish', x: 130, y: 595, scale: 0.9, rotation: -12 },
			{ role: 'accent', asset: '16-rainbow', x: 665, y: 125, scale: 0.75, rotation: 7 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 52
	},
	{
		title: 'Side Eye',
		category: 'Meme Reactions',
		layout: 'speech-bubble',
		text: 'EXCUSE ME?',
		font: 'Bangers',
		color: '#172449',
		photoAsset: 'peace-selfie',
		photo: { x: 150, y: 285, scale: 1.55, rotation: -4 },
		layers: [
			{ role: 'decoration', asset: '04-winking-smiley', x: 705, y: 555, scale: 1.05, rotation: 11 },
			{ role: 'accent', asset: '07-yellow-sparkle', x: 700, y: 180, scale: 0.85, rotation: -8 },
			{ role: 'accent', asset: '20-shooting-star', x: 510, y: 115, scale: 0.7, rotation: 20 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 62,
		caption: { x: 495, y: 195, rotation: -8 }
	},
	{
		title: 'Big Day',
		category: 'Birthday',
		layout: 'party-burst',
		text: 'BIG DAY!',
		font: 'Luckiest Guy',
		color: '#b85a08',
		photoAsset: 'waving-cat',
		photo: { x: 260, y: 245, scale: 1.4, rotation: 6 },
		layers: [
			{ role: 'decoration', asset: '16-rainbow', x: 125, y: 145, scale: 1, rotation: -13 },
			{ role: 'accent', asset: '17-yellow-star', x: 720, y: 175, scale: 1.15, rotation: 20 },
			{ role: 'accent', asset: '23-twinkles', x: 700, y: 650, scale: 0.85, rotation: -8 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 92,
		caption: { x: 175, y: 730, rotation: -5 }
	},
	{
		title: 'My Person',
		category: 'Love',
		layout: 'love-note',
		text: 'MY PERSON',
		font: 'Pacifico',
		color: '#db2777',
		photoAsset: 'peace-selfie',
		photo: { x: 365, y: 250, scale: 1.35, rotation: 5 },
		layers: [
			{ role: 'decoration', asset: '13-love-cats', x: 120, y: 515, scale: 1.05, rotation: -8 },
			{ role: 'accent', asset: '25-purple-heart', x: 690, y: 135, scale: 0.85, rotation: 14 },
			{ role: 'accent', asset: '12-small-pink-heart', x: 170, y: 195, scale: 0.7, rotation: -16 }
		],
		glasses: false,
		captionPaper: true,
		fontSize: 64,
		paper: { x: 155, y: 640, scale: 0.84, rotation: -13 }
	},
	{
		title: 'Ship Mode',
		category: 'Work',
		layout: 'work-stamp',
		text: 'SHIP IT',
		font: 'Plus Jakarta Sans',
		color: '#00875e',
		photoAsset: 'thumbs-up',
		photo: { x: 205, y: 225, scale: 1.45, rotation: 0 },
		layers: [
			{ role: 'decoration', asset: '22-green-sprout', x: 695, y: 605, scale: 0.85, rotation: 7 },
			{ role: 'accent', asset: '05-mint-sparkle-top', x: 690, y: 170, scale: 0.75, rotation: -5 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 64,
		caption: { x: 340, y: 788, rotation: 0 }
	},
	{
		title: 'Say Less',
		category: 'Text Stickers',
		layout: 'caption-bottom',
		text: 'SAY LESS',
		font: 'Fredoka',
		color: '#7c3aed',
		photoAsset: 'coffee-days',
		photo: { x: 305, y: 170, scale: 1.25, rotation: 3 },
		layers: [
			{ role: 'decoration', asset: '06-sunglasses', x: 150, y: 245, scale: 0.95, rotation: -15 },
			{ role: 'accent', asset: '05-mint-sparkle-top', x: 735, y: 285, scale: 0.8, rotation: 9 }
		],
		glasses: false,
		captionPaper: true,
		fontSize: 84,
		paper: { x: 145, y: 685, scale: 1, rotation: 2 }
	},
	{
		title: 'Soft Panic',
		category: 'Emotions',
		layout: 'corner-cluster',
		text: 'FINE-ISH',
		font: 'Chewy',
		color: '#c65b12',
		photoAsset: 'boba-tea',
		photo: { x: 115, y: 175, scale: 1.72, rotation: -3 },
		layers: [
			{ role: 'decoration', asset: 'happy-astronaut', x: 675, y: 560, scale: 0.95, rotation: 10 },
			{ role: 'accent', asset: '04-winking-smiley', x: 730, y: 735, scale: 0.75, rotation: -12 },
			{ role: 'accent', asset: '07-yellow-sparkle', x: 595, y: 760, scale: 0.65, rotation: 18 }
		],
		glasses: false,
		captionPaper: true,
		fontSize: 56,
		paper: { x: 130, y: 785, scale: 0.56, rotation: -6 }
	},
	{
		title: 'Fresh Air',
		category: 'Seasonal',
		layout: 'seasonal-sun',
		text: 'OUTSIDE ERA',
		font: 'Baloo 2',
		color: '#087ca7',
		photoAsset: 'sunny-corgi',
		photo: { x: 270, y: 270, scale: 1.4, rotation: -2 },
		layers: [
			{ role: 'decoration', asset: 'sunshine', x: 625, y: 125, scale: 1.05, rotation: 8 },
			{ role: 'accent', asset: 'cloud-rainbow', x: 115, y: 160, scale: 0.9, rotation: -6 },
			{ role: 'accent', asset: '22-green-sprout', x: 660, y: 700, scale: 0.9, rotation: 13 }
		],
		glasses: false,
		captionPaper: false,
		fontSize: 68,
		caption: { x: 240, y: 805, rotation: 3 }
	}
];

function transform(x: number, y: number, scaleX: number, scaleY = scaleX, rotation = 0): Transform {
	return { x, y, scaleX, scaleY, rotation };
}

function fromLocal(
	origin: Transform,
	localX: number,
	localY: number,
	scaleX: number,
	scaleY = scaleX,
	rotation = origin.rotation
): Transform {
	const radians = (origin.rotation * Math.PI) / 180;
	return transform(
		origin.x + localX * Math.cos(radians) - localY * Math.sin(radians),
		origin.y + localX * Math.sin(radians) + localY * Math.cos(radians),
		scaleX,
		scaleY,
		rotation
	);
}

function artwork(asset: string) {
	const illustration = ILLUSTRATION_BY_ID.get(asset);
	if (illustration) return { src: illustration.src, name: illustration.name, illustration: true };
	return {
		src: `/art/stickers/${asset}.webp`,
		name: STICKER_LABELS[asset] ?? asset,
		illustration: false
	};
}

function polaroidFrame(
	photo: Transform,
	displayWidth: number,
	displayHeight: number
): { frame: Transform; caption: Transform } {
	const pad = 30;
	const bottom = 128;
	const width = displayWidth + pad * 2;
	const height = displayHeight + pad + bottom;
	const frame = fromLocal(photo, -pad, -pad, width / 120, height / 120);
	return { frame, caption: fromLocal(frame, 40, 120 * frame.scaleY - 90, 1) };
}

function captionOnPaper(paper: Transform): Transform {
	return fromLocal(paper, 45, 35, 1);
}

/** Compositions, not individual sticker assets. Preview PNGs are generated from these documents. */
export const templateData: Template[] = specs.map((spec, index) => {
	const id = `sample-${index}`; // Keep existing favorite IDs stable.
	const assetSources: Record<string, string> = {};
	function image(
		assetId: string,
		name: string,
		src: string,
		pose: Transform,
		outlined = false
	): Extract<Layer, { kind: 'image' }> {
		assetSources[assetId] = src;
		const layer: Extract<Layer, { kind: 'image' }> = {
			id: `${id}-${assetId}`,
			kind: 'image',
			name,
			assetId,
			transform: pose,
			opacity: 1,
			visible: true,
			locked: false
		};
		if (outlined) layer.outline = { enabled: true, color: '#ffffff', width: 9 };
		return layer;
	}
	const standIn = PHOTO_BY_ID.get(spec.photoAsset);
	if (!standIn) throw new Error(`Unknown template photo: ${spec.photoAsset}`);
	const photoScale = spec.photo.scale * PHOTO_SCALE;
	const photoPose = transform(
		spec.photo.x,
		spec.photo.y,
		photoScale,
		photoScale,
		spec.photo.rotation
	);
	const display = TEMPLATE_PHOTO_SIZE * photoScale;
	const polaroid =
		spec.layout === 'polaroid' ? polaroidFrame(photoPose, display, display) : undefined;
	const photo = image('photo', 'Your photo', standIn.src, photoPose);
	const layers: Layer[] = [];
	if (polaroid) {
		layers.push({
			id: `${id}-frame`,
			kind: 'shape',
			name: 'Photo frame',
			shape: 'rectangle',
			fill: '#ffffff',
			transform: polaroid.frame,
			opacity: 1,
			visible: true,
			locked: false
		});
	}
	layers.push(photo);
	if (spec.glasses) {
		const k = spec.photo.scale / 1.9;
		layers.push(
			image(
				'glasses',
				'Sunglasses',
				'/art/stickers/06-sunglasses.webp',
				fromLocal(photoPose, 180 * k, 80 * k, 1.7 * k)
			)
		);
	}
	for (const [layerIndex, item] of spec.layers.entries()) {
		const art = artwork(item.asset);
		const scale = art.illustration ? item.scale * ILLUSTRATION_SCALE : item.scale;
		layers.push(
			image(
				`deco-${layerIndex}`,
				art.name,
				art.src,
				transform(item.x, item.y, scale, scale, item.rotation)
			)
		);
	}
	if (spec.layout === 'speech-bubble' && spec.caption) {
		const captionPose = transform(spec.caption.x, spec.caption.y, 1, 1, spec.caption.rotation);
		layers.push({
			id: `${id}-frame`,
			kind: 'shape',
			name: 'Caption bubble',
			shape: 'circle',
			fill: '#ffffff',
			transform: fromLocal(captionPose, -86, -72, 4.6, 2.15),
			opacity: 1,
			visible: true,
			locked: false
		});
	}
	if (spec.layout === 'work-stamp' && spec.caption) {
		const captionPose = transform(spec.caption.x, spec.caption.y, 1, 1, spec.caption.rotation);
		layers.push({
			id: `${id}-frame`,
			kind: 'shape',
			name: 'Stamp plate',
			shape: 'rectangle',
			fill: '#e7f8ef',
			transform: fromLocal(captionPose, -48, -28, 4.6, 1.2),
			opacity: 1,
			visible: true,
			locked: false
		});
	}
	let captionPose: Transform;
	if (polaroid) {
		captionPose = polaroid.caption;
	} else if (spec.captionPaper && spec.paper) {
		const paper = image(
			'caption-paper',
			'Caption backing',
			'/art/templates/caption-paper.png',
			transform(spec.paper.x, spec.paper.y, spec.paper.scale, spec.paper.scale, spec.paper.rotation)
		);
		layers.push(paper);
		captionPose = captionOnPaper(paper.transform);
	} else if (spec.caption) {
		captionPose = transform(spec.caption.x, spec.caption.y, 1, 1, spec.caption.rotation);
	} else {
		throw new Error(`Template ${spec.title} is missing caption placement`);
	}
	layers.push({
		id: `${id}-caption`,
		kind: 'text',
		name: 'Your caption',
		content: spec.text,
		fontFamily: spec.font,
		fontSize: spec.fontSize,
		color: spec.color,
		transform: captionPose,
		opacity: 1,
		visible: true,
		locked: false
	});
	return {
		id,
		title: spec.title,
		category: spec.category,
		tags: ['photo', 'editable', spec.layout],
		preview: '',
		previewImage: `/art/templates/${id}.png`,
		assetSources,
		document: {
			schemaVersion: 1,
			id: `seed-${index}`,
			title: spec.title,
			artboard: { width: 1024, height: 1024, background: 'transparent' },
			layers,
			assetIds: Object.keys(assetSources),
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			revision: 0
		}
	};
});

/** Load validated artwork before saving; every copy owns independent asset IDs. */
export async function instantiateTemplate(template: Template) {
	const document = cloneTemplateDocument(template);
	const assets = await Promise.all(
		document.assetIds.map(async (id) => {
			const src = template.assetSources?.[id];
			if (!src) throw new Error(`Missing template artwork: ${id}`);
			return ingestBundledImage(src);
		})
	);
	const ids = new Map(document.assetIds.map((id, index) => [id, assets[index]!.asset.id]));
	document.assetIds = assets.map(({ asset }) => asset.id);
	document.layers = document.layers.map((layer) =>
		layer.kind === 'image' ? { ...layer, assetId: ids.get(layer.assetId)! } : layer
	);
	return { document, assets };
}

export function cloneTemplateDocument(template: Template): ProjectDocument {
	const now = new Date().toISOString();
	return {
		...structuredClone(template.document),
		id: crypto.randomUUID(),
		title: `${template.title} Copy`,
		layers: structuredClone(template.document.layers).map((layer) => ({
			...layer,
			id: crypto.randomUUID()
		})),
		createdAt: now,
		updatedAt: now,
		revision: 0
	};
}

const FAV_TEMPLATES_KEY = 'stickerlab_fav_templates';
const memoryFavorites = new Set<string>();

export function getFavoriteTemplateIds(): string[] {
	try {
		const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
		if (!storage) return Array.from(memoryFavorites);
		const raw = storage.getItem(FAV_TEMPLATES_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))]
			: [];
	} catch {
		return Array.from(memoryFavorites);
	}
}

export function toggleFavoriteTemplateId(id: string): string[] {
	const current = getFavoriteTemplateIds();
	const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
	try {
		const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
		if (storage) storage.setItem(FAV_TEMPLATES_KEY, JSON.stringify(next));
	} catch {
		// storage disabled
	}
	memoryFavorites.clear();
	for (const item of next) memoryFavorites.add(item);
	if (typeof window !== 'undefined') window.dispatchEvent(new Event('stickerlab:favorites'));
	return next;
}
