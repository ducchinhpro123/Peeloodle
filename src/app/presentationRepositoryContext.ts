import { createContext, useContext } from 'react'
import type { PresentationRepository } from '../lib/persistence/presentations/repository'

export const PresentationRepositoryContext = createContext<PresentationRepository | null>(null)

export function usePresentationRepository(): PresentationRepository {
  const repository = useContext(PresentationRepositoryContext)
  if (!repository) throw new Error('usePresentationRepository requires PresentationRepositoryProvider')
  return repository
}
