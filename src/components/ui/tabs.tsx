import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'
import { cn } from '@/lib/utils'

const Tabs = {
  Root: ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>) => <TabsPrimitive.Root data-slot="tabs" className={className} {...props} />,
  List: React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
    ({ className, ...props }, ref) => <TabsPrimitive.List ref={ref} data-slot="tabs-list" className={cn('tabs-list', className)} {...props} />,
  ),
  Trigger: React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
    ({ className, ...props }, ref) => <TabsPrimitive.Trigger ref={ref} data-slot="tabs-trigger" className={cn('tabs-trigger', className)} {...props} />,
  ),
  Content: React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
    ({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} data-slot="tabs-content" className={cn('tabs-content', className)} {...props} />,
  ),
}

export { Tabs }
