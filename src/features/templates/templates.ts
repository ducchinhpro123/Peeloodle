import type { Layer, ProjectDocument, Template, Transform } from '../../types/domain'
import { ingestBundledImage } from '../assets/assetLoader'

export const TEMPLATE_CATEGORIES = ['All Templates', 'Trending', 'Cute Animals', 'Meme Reactions', 'Birthday', 'Love', 'Work', 'Text Stickers', 'Emotions', 'Seasonal'] as const

const specs = [
  { title: 'Good Vibes', category: 'Trending', text: 'Good Vibes!', font: 'Pacifico', color: '#df1688', decoration: '14-large-pink-heart', accent: '07-yellow-sparkle', tilt: -6 },
  { title: 'Cat Expressions', category: 'Cute Animals', text: 'Meow!', font: 'Chewy', color: '#172449', decoration: '25-purple-heart', accent: '23-twinkles', tilt: 5 },
  { title: 'Stay Cool', category: 'Meme Reactions', text: 'STAY COOL', font: 'Bangers', color: '#087ca7', decoration: '17-yellow-star', accent: '07-yellow-sparkle', tilt: -5, glasses: true },
  { title: 'Daily Vibes', category: 'Trending', text: 'Just chillin’', font: 'Fredoka', color: '#00875e', decoration: '22-green-sprout', accent: '23-twinkles', tilt: 4 },
  { title: 'Best Buddy', category: 'Cute Animals', text: 'Best buddy', font: 'Chewy', color: '#172449', decoration: '14-large-pink-heart', accent: '17-yellow-star', tilt: -4, glasses: true },
  { title: 'Selfie Stickers', category: 'Emotions', text: 'Feeling cute', font: 'Fredoka', color: '#df1688', decoration: '25-purple-heart', accent: '07-yellow-sparkle', tilt: 5 },
  { title: 'Birthday Fun', category: 'Birthday', text: 'PARTY TIME!', font: 'Luckiest Guy', color: '#7c3aed', decoration: '16-rainbow', accent: '23-twinkles', tilt: -3 },
  { title: 'Love Notes', category: 'Love', text: 'You & me', font: 'Pacifico', color: '#df1688', decoration: '14-large-pink-heart', accent: '25-purple-heart', tilt: 3 },
  { title: 'Work Wins', category: 'Work', text: 'NAILED IT!', font: 'Bangers', color: '#00875e', decoration: '17-yellow-star', accent: '23-twinkles', tilt: -5 },
  { title: 'Seasonal Smiles', category: 'Seasonal', text: 'Sunny days', font: 'Chewy', color: '#b85a08', decoration: '16-rainbow', accent: '07-yellow-sparkle', tilt: 4 },
  { title: 'Text Stickers', category: 'Text Stickers', text: 'BIG MOOD', font: 'Luckiest Guy', color: '#087ca7', decoration: '25-purple-heart', accent: '17-yellow-star', tilt: -4 },
  { title: 'Big Reactions', category: 'Meme Reactions', text: 'WAIT, WHAT?!', font: 'Bangers', color: '#df1688', decoration: '17-yellow-star', accent: '07-yellow-sparkle', tilt: 5 },
]

/** Compositions, not individual sticker assets. Preview PNGs are generated from these documents. */
export const templateData: Template[] = specs.map((spec, index) => {
  const id = `sample-${index}` // Keep existing favorite IDs stable.
  const assetSources: Record<string, string> = {}
  function image(assetId: string, name: string, src: string, transform: Transform): Extract<Layer, { kind: 'image' }> {
    assetSources[assetId] = src
    return { id: `${id}-${assetId}`, kind: 'image', name, assetId, transform, opacity: 1, visible: true, locked: false }
  }
  const transform = (x: number, y: number, scale = 1, rotation = 0): Transform => ({ x, y, scaleX: scale, scaleY: scale, rotation })
  const photo = image('photo', 'Your photo', '/samples/cat-in-console.png', transform(185, 270, 1.9, -7))
  photo.crop = { x: 0, y: 70, width: 344, height: 220 }
  photo.outline = { enabled: true, color: '#ffffff', width: 9 }
  const layers: Layer[] = [
    photo,
    image('decoration', 'Heart / badge', `/art/stickers/${spec.decoration}.webp`, transform(720, 185, 0.85, 12)),
    image('accent', 'Sparkles / accent', `/art/stickers/${spec.accent}.webp`, transform(140, 150, 1.1, -12)),
  ]
  if (spec.glasses) layers.push(image('glasses', 'Sunglasses', '/art/stickers/06-sunglasses.webp', transform(365, 350, 1.7, -7)))
  layers.push(image('caption-paper', 'Caption backing', '/art/templates/caption-paper.png', transform(190, 650, 0.9, spec.tilt)))
  const radians = spec.tilt * Math.PI / 180
  layers.push({
    id: `${id}-caption`, kind: 'text', name: 'Your caption', content: spec.text,
    fontFamily: spec.font, fontSize: 88, color: spec.color,
    transform: transform(190 + 45 * Math.cos(radians) - 35 * Math.sin(radians), 650 + 45 * Math.sin(radians) + 35 * Math.cos(radians), 1, spec.tilt),
    opacity: 1, visible: true, locked: false,
  })
  return {
    id, title: spec.title, category: spec.category, tags: ['photo', 'editable'], preview: '',
    previewImage: `/art/templates/${id}.png`, assetSources,
    document: {
      schemaVersion: 1, id: `seed-${index}`, title: spec.title,
      artboard: { width: 1024, height: 1024, background: 'transparent' }, layers,
      assetIds: Object.keys(assetSources),
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 0,
    },
  }
})

/** Load validated artwork before saving; every copy owns independent asset IDs. */
export async function instantiateTemplate(template: Template) {
  const document = cloneTemplateDocument(template)
  const assets = await Promise.all(document.assetIds.map(async (id) => {
    const src = template.assetSources?.[id]
    if (!src) throw new Error(`Missing template artwork: ${id}`)
    return ingestBundledImage(src)
  }))
  const ids = new Map(document.assetIds.map((id, index) => [id, assets[index]!.asset.id]))
  document.assetIds = assets.map(({ asset }) => asset.id)
  document.layers = document.layers.map((layer) => layer.kind === 'image'
    ? { ...layer, assetId: ids.get(layer.assetId)! }
    : layer)
  return { document, assets }
}

export function cloneTemplateDocument(template: Template): ProjectDocument {
  const now = new Date().toISOString()
  return {
    ...structuredClone(template.document),
    id: crypto.randomUUID(), title: `${template.title} Copy`,
    layers: structuredClone(template.document.layers).map((layer) => ({ ...layer, id: crypto.randomUUID() })),
    createdAt: now, updatedAt: now, revision: 0,
  }
}

const FAV_TEMPLATES_KEY = 'stickerlab_fav_templates'
const memoryFavorites = new Set<string>()

export function getFavoriteTemplateIds(): string[] {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined
    if (!storage) return Array.from(memoryFavorites)
    const raw = storage.getItem(FAV_TEMPLATES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))] : []
  } catch {
    return Array.from(memoryFavorites)
  }
}

export function toggleFavoriteTemplateId(id: string): string[] {
  const current = getFavoriteTemplateIds()
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined
    if (storage) storage.setItem(FAV_TEMPLATES_KEY, JSON.stringify(next))
  } catch {
    // storage disabled
  }
  memoryFavorites.clear()
  for (const item of next) memoryFavorites.add(item)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('stickerlab:favorites'))
  return next
}
