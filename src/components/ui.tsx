import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import * as React from 'react'

function cn(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ')
}

// Adapted from the official shadcn/ui sources recorded in docs/shadcn-provenance.md.
// The project keeps its installed Radix packages and mint CSS classes.
const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} data-slot="button" className={cn('button', className)} {...props} />
  ),
)
Button.displayName = 'Button'

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section data-slot="card" className={cn('card', className)}>{children}</section>
}

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />
}

function DialogDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" {...props} />
}

function DialogContent({ children, className, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="overlay" />
      <DialogPrimitive.Content data-slot="dialog-content" className={cn('dialog', className)} {...props}>
        <div className="dialog-scroll">{children}</div>
        <DialogPrimitive.Close asChild>
          <Button data-slot="dialog-close" className="icon close" aria-label="Close dialog"><X /></Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="dialog-footer">{children}</div>
}

function NoticeDialog({ trigger, title, children }: { trigger: React.ReactElement; title: string; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="muted">{children}</div>
        </DialogDescription>
        <DialogFooter><DialogClose asChild><Button className="primary">Got it</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" {...props} />
}

function SheetDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="sheet-description" {...props} />
}

function SheetContent({ children, className, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <DialogPrimitive.Overlay data-slot="sheet-overlay" className="overlay" />
      <DialogPrimitive.Content data-slot="sheet-content" className={cn('sheet', className)} {...props}>
        {children}
        <DialogPrimitive.Close asChild>
          <Button data-slot="sheet-close" className="icon close" aria-label="Close navigation"><X /></Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

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

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(
  ({ className, defaultValue, value, min = 0, max = 100, 'aria-label': ariaLabel, ...props }, ref) => {
    const values = React.useMemo(() => Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max], [value, defaultValue, min, max])
    return (
      <SliderPrimitive.Root ref={ref} data-slot="slider" defaultValue={defaultValue} value={value} min={min} max={max} className={cn('slider', className)} {...props}>
        <SliderPrimitive.Track data-slot="slider-track" className="slider-track">
          <SliderPrimitive.Range data-slot="slider-range" className="slider-range" />
        </SliderPrimitive.Track>
        {values.map((_, index) => <SliderPrimitive.Thumb aria-label={ariaLabel} data-slot="slider-thumb" key={index} className="slider-thumb" />)}
      </SliderPrimitive.Root>
    )
  },
)
Slider.displayName = 'Slider'

export {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  NoticeDialog,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  Slider,
  Tabs,
}
