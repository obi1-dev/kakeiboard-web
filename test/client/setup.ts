import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom doesn't implement these, but Radix UI's Select (used by several
// pages) calls them when opening/scrolling its popover - without these
// no-op polyfills, clicking a Select trigger under userEvent throws.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom doesn't implement these either, but ScanPage uses them to preview
// the selected receipt image before upload.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock-url'
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {}
}

afterEach(() => {
  cleanup()
})
