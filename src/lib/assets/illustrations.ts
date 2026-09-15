// User-supplied art; source mapping and processing in docs/assets-provenance.md.
export const ILLUSTRATIONS = [
	{ id: 'happy-astronaut', name: 'Happy Astronaut', category: 'Space' },
	{ id: 'sunshine', name: 'Sunshine', category: 'Seasonal' },
	{ id: 'little-rocket', name: 'Little Rocket', category: 'Space' },
	{ id: 'cool-corgi', name: 'Cool Corgi', category: 'Cute Animals' },
	{ id: 'happy-kitten', name: 'Happy Kitten', category: 'Cute Animals' },
	{ id: 'playful-corgi', name: 'Playful Corgi', category: 'Cute Animals' },
	{ id: 'cloud-rainbow', name: 'Cloud Rainbow', category: 'Seasonal' },
	{ id: 'happy-planet', name: 'Happy Planet', category: 'Space' }
].map((art) => ({ ...art, src: `/art/illustrations/${art.id}.webp` }));
