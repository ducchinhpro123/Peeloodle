import { createContext, useContext, type ReactNode } from 'react'
import type { TextEditSession } from './textEditSession'

const TextEditSessionContext = createContext<TextEditSession | null>(null)

export function TextEditSessionProvider({ session, children }: { session: TextEditSession; children: ReactNode }) {
  return <TextEditSessionContext.Provider value={session}>{children}</TextEditSessionContext.Provider>
}

export function useTextEditSession(): TextEditSession {
  const session = useContext(TextEditSessionContext)
  if (!session) throw new Error('useTextEditSession requires TextEditSessionProvider')
  return session
}
