import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { createAppRouter } from './app/routes'
import './styles.css'
import './features/presentations/rendering/presentation-fonts.css'

if (import.meta.env.MODE !== 'test') createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={createAppRouter()} /></StrictMode>)
