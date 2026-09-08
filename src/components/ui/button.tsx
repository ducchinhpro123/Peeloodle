import * as React from 'react'
import { cn } from '@/lib/utils'

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} data-slot="button" className={cn('button', className)} {...props} />
  ),
)
Button.displayName = 'Button'

export { Button }
