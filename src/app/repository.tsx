import { createContext, useContext, type ReactNode } from 'react'
import { getLocalRepository, type StickerLabRepository } from '../lib/persistence/repository'

const RepositoryContext = createContext<StickerLabRepository | null>(null)

export function RepositoryProvider({
  repository,
  children,
}: {
  repository?: StickerLabRepository
  children: ReactNode
}) {
  const value = repository ?? getLocalRepository()
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>
}

export function useRepository(): StickerLabRepository {
  const repository = useContext(RepositoryContext)
  if (!repository) throw new Error('useRepository requires RepositoryProvider')
  return repository
}
