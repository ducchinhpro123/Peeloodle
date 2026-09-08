import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section data-slot="card" className={cn('card', className)}>{children}</section>
}

export { Card }
