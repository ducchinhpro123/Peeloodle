import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'
import { cn } from '@/lib/utils'

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

export { Slider }
