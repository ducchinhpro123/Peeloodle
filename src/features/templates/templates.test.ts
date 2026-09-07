import { expect, it } from 'vitest'
import { cloneTemplateDocument, templateData } from './templates'

it('isolates nested layer settings when cloning a template', () => {
  const template = structuredClone(templateData[0]!)
  template.document.layers.push({ id: 'image', kind: 'image', name: 'Image', assetId: 'asset', opacity: 1, visible: true, locked: false, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, filters: { brightness: 0, contrast: 0, saturation: 0, grayscale: 0 }, outline: { enabled: true, color: '#ffffff', width: 12 } })
  template.document.assetIds = ['asset']
  const cloned = cloneTemplateDocument(template)
  const image = cloned.layers.at(-1)!
  if (image.kind !== 'image') throw new Error('Missing cloned image')
  image.filters!.brightness = 50
  image.outline!.width = 20
  expect(template.document.layers.at(-1)).toMatchObject({ filters: { brightness: 0 }, outline: { width: 12 } })
})
