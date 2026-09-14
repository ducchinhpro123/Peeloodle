import type { ProjectDocument } from '../../types/domain'
import { isPersistenceError, type StickerLabRepository } from '../../lib/persistence/repository'

async function settleCloud(repo: StickerLabRepository) {
  await repo.sync?.settle()
}

/** Clear pack membership, then delete. Restore membership if the sticker survives a rejected stale delete. */
export async function removeProject(repo: StickerLabRepository, project: ProjectDocument) {
  const id = project.id
  const members = (await repo.listPacks()).filter((pack) => pack.projectIds.includes(id))
  const now = new Date().toISOString()
  for (const pack of members) {
    await repo.savePack({ ...pack, projectIds: pack.projectIds.filter((projectId) => projectId !== id), updatedAt: now })
  }
  await repo.deleteProject(id)
  await settleCloud(repo)
  try {
    await repo.getProject(id)
  } catch (error) {
    if (isPersistenceError(error) && error.code === 'not_found') return
    throw error
  }
  const latest = await repo.listPacks()
  const restoredAt = new Date().toISOString()
  for (const pack of members) {
    const current = latest.find((item) => item.id === pack.id)
    if (!current || current.projectIds.includes(id)) continue
    await repo.savePack({ ...current, projectIds: pack.projectIds, updatedAt: restoredAt })
  }
  await settleCloud(repo)
}
