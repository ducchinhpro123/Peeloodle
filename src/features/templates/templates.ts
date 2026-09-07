import type { ProjectDocument, Template } from '../../types/domain'

const samples = ['🐶', '🐱', '💖', '👑', '😎', '✨', '🌈', '☕', '🎉', '🔥', '🌸', '🍕']
const categories = [
  'All Templates',
  'Trending',
  'Cute Animals',
  'Meme Reactions',
  'Birthday',
  'Love',
  'Work',
  'Text Stickers',
  'Emotions',
  'Seasonal',
] as const

export const TEMPLATE_CATEGORIES = categories

type SeedLayerSpec =
  | { kind: 'text'; text: string; font?: string; size?: number; color?: string; x?: number; y?: number }
  | { kind: 'shape'; shape: 'circle' | 'rectangle'; fill: string; x?: number; y?: number }

const templateSpecs: Array<{ title: string; category: string; tags: string[]; preview: string; layers: SeedLayerSpec[] }> = [
  {
    title: 'Good Vibes Pack',
    category: 'Trending',
    tags: ['free', 'cute'],
    preview: '✨',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#ffddea', x: 260, y: 260 },
      { kind: 'text', text: 'GOOD VIBES\nONLY', font: 'Plus Jakarta Sans', size: 68, color: '#08b879', x: 290, y: 440 },
    ],
  },
  {
    title: 'Cat Expressions',
    category: 'Cute Animals',
    tags: ['free', 'cute'],
    preview: '🐱',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#ddf7ed', x: 300, y: 280 },
      { kind: 'text', text: 'PURR-FECT!', font: 'Plus Jakarta Sans', size: 64, color: '#ff4d9a', x: 310, y: 450 },
    ],
  },
  {
    title: 'Meme Essentials',
    category: 'Meme Reactions',
    tags: ['free', 'fun'],
    preview: '😎',
    layers: [
      { kind: 'shape', shape: 'rectangle', fill: '#fff5d8', x: 260, y: 320 },
      { kind: 'text', text: 'WAIT\nWHAT?!', font: 'Plus Jakarta Sans', size: 72, color: '#08152f', x: 340, y: 420 },
    ],
  },
  {
    title: 'Daily Vibes',
    category: 'Trending',
    tags: ['free', 'fun'],
    preview: '☕',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#e8f4ff', x: 280, y: 280 },
      { kind: 'text', text: 'COFFEE FIRST', font: 'Plus Jakarta Sans', size: 60, color: '#3b82f6', x: 280, y: 460 },
    ],
  },
  {
    title: 'Cool Pets',
    category: 'Cute Animals',
    tags: ['free', 'cute'],
    preview: '🐶',
    layers: [
      { kind: 'shape', shape: 'rectangle', fill: '#ddf7ed', x: 270, y: 300 },
      { kind: 'text', text: 'PAWSOME!', font: 'Plus Jakarta Sans', size: 64, color: '#08b879', x: 310, y: 450 },
    ],
  },
  {
    title: 'Selfie Stickers',
    category: 'Emotions',
    tags: ['free', 'cute'],
    preview: '💖',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#fceaf3', x: 290, y: 270 },
      { kind: 'text', text: 'FEELING CUTE', font: 'Georgia', size: 56, color: '#ff4d9a', x: 280, y: 460 },
    ],
  },
  {
    title: 'Birthday Fun',
    category: 'Birthday',
    tags: ['free', 'fun'],
    preview: '🎉',
    layers: [
      { kind: 'shape', shape: 'rectangle', fill: '#f0eafe', x: 250, y: 290 },
      { kind: 'text', text: 'PARTY TIME!', font: 'Plus Jakarta Sans', size: 64, color: '#8b5cf6', x: 290, y: 450 },
    ],
  },
  {
    title: 'Love Notes',
    category: 'Love',
    tags: ['free', 'cute'],
    preview: '👑',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#fceaf3', x: 300, y: 280 },
      { kind: 'text', text: 'YOU & ME', font: 'Georgia', size: 64, color: '#ff4d9a', x: 330, y: 460 },
    ],
  },
  {
    title: 'Work Wins',
    category: 'Work',
    tags: ['free', 'fun'],
    preview: '🔥',
    layers: [
      { kind: 'shape', shape: 'rectangle', fill: '#ddf7ed', x: 260, y: 310 },
      { kind: 'text', text: 'NAILED IT!', font: 'Plus Jakarta Sans', size: 64, color: '#08b879', x: 320, y: 450 },
    ],
  },
  {
    title: 'Seasonal Smiles',
    category: 'Seasonal',
    tags: ['free', 'cute'],
    preview: '🌸',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#fff5d8', x: 290, y: 290 },
      { kind: 'text', text: 'SUNNY DAYS', font: 'Plus Jakarta Sans', size: 60, color: '#f59e0b', x: 300, y: 460 },
    ],
  },
  {
    title: 'Text Stickers',
    category: 'Text Stickers',
    tags: ['free', 'fun'],
    preview: '🌈',
    layers: [
      { kind: 'shape', shape: 'rectangle', fill: '#e8f4ff', x: 260, y: 310 },
      { kind: 'text', text: 'BIG MOOD', font: 'Plus Jakarta Sans', size: 70, color: '#3b82f6', x: 320, y: 440 },
    ],
  },
  {
    title: 'Big Reactions',
    category: 'Meme Reactions',
    tags: ['free', 'fun'],
    preview: '🍕',
    layers: [
      { kind: 'shape', shape: 'circle', fill: '#ffddea', x: 280, y: 280 },
      { kind: 'text', text: 'MIND BLOWN!', font: 'Plus Jakarta Sans', size: 62, color: '#ec4899', x: 290, y: 450 },
    ],
  },
]

export const templateData: Template[] = templateSpecs.map((spec, index) => {
  const templateId = `sample-${index}`
  const docId = `seed-${index}`
  const layers = spec.layers.map((l, lIdx) => {
    const id = `layer-${index}-${lIdx}`
    if (l.kind === 'text') {
      return {
        id,
        name: `Text: ${l.text.split('\n')[0]}`,
        kind: 'text' as const,
        content: l.text,
        fontFamily: l.font ?? 'Plus Jakarta Sans',
        fontSize: l.size ?? 64,
        color: l.color ?? '#08152f',
        transform: { x: l.x ?? 320, y: l.y ?? 430, rotation: 0, scaleX: 1, scaleY: 1 },
        opacity: 1,
        visible: true,
        locked: false,
      }
    }
    return {
      id,
      name: `${l.shape === 'circle' ? 'Circle' : 'Rectangle'} Accent`,
      kind: 'shape' as const,
      shape: l.shape,
      fill: l.fill,
      transform: { x: l.x ?? 300, y: l.y ?? 300, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: 1,
      visible: true,
      locked: false,
    }
  })

  return {
    id: templateId,
    title: spec.title,
    category: spec.category,
    tags: spec.tags,
    preview: spec.preview || samples[index % samples.length] || '✨',
    document: {
      schemaVersion: 1,
      id: docId,
      title: spec.title,
      artboard: { width: 1024, height: 1024, background: 'transparent' },
      layers,
      assetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 0,
    },
  }
})

export function cloneTemplateDocument(template: Template): ProjectDocument {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const layers = template.document.layers.map((layer) => ({
    ...layer,
    id: crypto.randomUUID(),
    transform: { ...layer.transform },
  }))
  return {
    ...template.document,
    id,
    title: `${template.title} Copy`,
    layers,
    assetIds: [...template.document.assetIds],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }
}

const FAV_TEMPLATES_KEY = 'stickerlab_fav_templates'
const memoryFavorites = new Set<string>()

export function getFavoriteTemplateIds(): string[] {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined
    if (!storage) return Array.from(memoryFavorites)
    const raw = storage.getItem(FAV_TEMPLATES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return Array.from(memoryFavorites)
  }
}

export function toggleFavoriteTemplateId(id: string): string[] {
  const current = getFavoriteTemplateIds()
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined
    if (storage) {
      storage.setItem(FAV_TEMPLATES_KEY, JSON.stringify(next))
    }
  } catch {
    // storage disabled
  }
  memoryFavorites.clear()
  for (const item of next) memoryFavorites.add(item)
  return next
}
