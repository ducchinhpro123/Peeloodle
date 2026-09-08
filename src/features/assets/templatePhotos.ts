// User-supplied art; source mapping and processing in docs/assets-provenance.md.
export const TEMPLATE_PHOTOS = [
  { id: 'boba-tea', name: 'Boba tea', category: 'Food' },
  { id: 'peace-selfie', name: 'Peace selfie', category: 'People' },
  { id: 'thumbs-up', name: 'Thumbs up', category: 'People' },
  { id: 'coffee-days', name: 'Coffee days', category: 'People' },
  { id: 'sunny-corgi', name: 'Sunny corgi', category: 'Cute Animals' },
  { id: 'waving-cat', name: 'Waving cat', category: 'Cute Animals' },
].map((art) => ({ ...art, src: `/art/template-photos/${art.id}.webp` }))

export const TEMPLATE_PHOTO_SIZE = 1024
