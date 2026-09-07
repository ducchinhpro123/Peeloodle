/* global FileReader */
import { Buffer } from 'node:buffer'
import { log } from 'node:console'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

// Run against the local Vite server; previews use the same renderer as PNG export.
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4173/templates')
  const previews = await page.evaluate(async () => {
    const templatesPath = '/src/features/templates/templates.ts'
    const renderPath = '/src/features/exports/renderDocument.ts'
    const { templateData, instantiateTemplate } = await import(templatesPath)
    const { renderDocument } = await import(renderPath)
    const previews = []
    for (const template of templateData) {
      const { document, assets } = await instantiateTemplate(template)
      const blob = await renderDocument(document, Object.fromEntries(assets.map((record) => [record.asset.id, record])), { size: 512 })
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      previews.push({ id: template.id, dataUrl })
    }
    return previews
  })
  await mkdir('public/art/templates', { recursive: true })
  for (const { id, dataUrl } of previews) await writeFile(`public/art/templates/${id}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'))
  log(`Generated ${previews.length} document-matched previews.`)
} finally {
  await browser.close()
}
