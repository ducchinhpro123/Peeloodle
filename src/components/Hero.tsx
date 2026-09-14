import type { ReactNode } from 'react'

export function Hero({ title, children, action, art, kicker, points, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; art?: ReactNode; kicker?: ReactNode; points?: ReactNode; className?: string }) {
  return (
    <section className={className ? `hero ${className}` : 'hero'}>
      <div className="hero-copy">
        {kicker}
        <h1>{title}</h1>
        <p className="hero-lead">{children}</p>
        {action}
        {points}
      </div>
      {art}
    </section>
  )
}
