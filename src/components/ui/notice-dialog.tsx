import type { ReactElement, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

function NoticeDialog({ trigger, title, children }: { trigger: ReactElement; title: string; children: ReactNode }) {
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

export { NoticeDialog }
