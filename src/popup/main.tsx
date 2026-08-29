import { createRoot } from 'react-dom/client'
import '../ui/styles.css'
import { applyScreenKind } from '../ui/device.ts'
import { App } from './App.tsx'

// Before the first render, so the browser never sizes the popup to a layout
// meant for the other kind of device.
applyScreenKind()

createRoot(document.getElementById('root')!).render(<App />)
