import { useState, type ReactNode } from 'react'
import { createIdbPresentationRepository } from '../lib/persistence/presentations/idb'
import type { PresentationRepository } from '../lib/persistence/presentations/repository'
import { PresentationRepositoryContext } from './presentationRepositoryContext'

export function PresentationRepositoryProvider({
  repository,
  children,
}: {
  repository?: PresentationRepository
  children: ReactNode
}) {
  const [localRepository] = useState(() => repository ?? createIdbPresentationRepository())

  return (
    <PresentationRepositoryContext.Provider value={repository ?? localRepository}>
      {children}
    </PresentationRepositoryContext.Provider>
  )
}
