import { describe, expect, it } from 'vitest'
import { matchPacks, matchTemplates, packSearchHref, templateSearchHref } from './searchLibrary'
import type { PackRecord, Template } from '../../types/domain'

function template(id: string, title: string, category: string, tags: string[]): Template {
  return { id, title, category, tags, preview: null, document: { layers: [] } } as unknown as Template
}

function pack(overrides: Partial<PackRecord> = {}): PackRecord {
  return {
    id: 'pack-1',
    title: 'Beta Cats',
    description: 'Sleepy afternoon friends',
    visibility: 'local',
    projectIds: ['a', 'b'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('library search matching', () => {
  it('matches templates on title, category and tags, case-insensitively', () => {
    const templates = [template('orbit-pop', 'Orbit Pop', 'Space', ['planet', 'retro']), template('pet', 'Pet Bestie', 'Cute Animals', ['cat'])]
    expect(matchTemplates(templates, 'ORBIT').map((item) => item.id)).toEqual(['orbit-pop'])
    expect(matchTemplates(templates, 'space').map((item) => item.id)).toEqual(['orbit-pop'])
    expect(matchTemplates(templates, 'cat').map((item) => item.id)).toEqual(['pet'])
    expect(matchTemplates(templates, '   ').map((item) => item.id)).toEqual(['orbit-pop', 'pet'])
  })

  it('matches packs on title and description', () => {
    const packs = [pack(), pack({ id: 'alpha', title: 'Alpha Days', description: 'Sunny little reactions' })]
    expect(matchPacks(packs, 'sleepy afternoon').map((item) => item.id)).toEqual(['pack-1'])
    expect(matchPacks(packs, 'alpha').map((item) => item.id)).toEqual(['alpha'])
    expect(matchPacks(packs, 'nowhere')).toEqual([])
  })

  it('builds encoded result links', () => {
    expect(templateSearchHref('Orbit Pop')).toBe('/templates?q=Orbit%20Pop')
    expect(packSearchHref('pack 1&2')).toBe('/my-stickers?pack=pack%201%262')
  })
})
