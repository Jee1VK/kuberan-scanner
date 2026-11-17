# DESIGN.md - Kuberan Scanner Design System Specification
<!-- Specification Standard: Google Stitch (Google Labs) -->
<!-- Brand: Kuberan Silks Heritage Engineering -->
<!-- Version: 1.3.6 -->

## 1. Design Philosophy & Brand Personality
- **Showroom & Warehouse Precision:** Kuberan Scanner is a mobile-first Progressive Web App engineered for Chickpet showroom and warehouse staff to photograph silk sarees, bind barcodes (`{barcode}.jpg`), and export batch catalogs.
- **Heritage Luxury Palette:** Grounded in Kuberan Silks' signature **Imperial Kumkum Maroon (`#6B1D2F`)**, **Antique Temple Gold (`#C5A059`)**, **Auspicious Temple Green (`#1B4D3E`)**, and **Warm Pearl Ivory (`#FAFAF7`)** for zero eye strain under bright showroom lighting.
- **Tactile One-Handed Ergonomics:** Every control is sized for fast, one-handed thumb operation while holding garments and barcode hangtags.

---

## 2. Design Tokens (Color Hierarchy)

```css
:root {
  /* Brand Heritage Tokens */
  --color-brand-primary:      #6B1D2F; /* Imperial Kumkum Maroon */
  --color-brand-primary-dark: #521523; /* Deep Maroon Hover/Active */
  --color-brand-accent:       #C5A059; /* Antique Temple Gold (Zari) */
  --color-brand-secondary:    #1B4D3E; /* Auspicious Temple Green */

  /* Canvas & Surface Tokens */
  --color-canvas-base:        #FAFAF7; /* Warm Pearl Ivory */
  --color-surface-card:       #FFFFFF; /* Pure White Elevated Card */
  --color-surface-elevated:   #F3EFEA; /* Soft Sandstone Secondary Surface */
  --color-border-subtle:      #EAE5DC; /* Crisp 1px Tactile Border */
  --color-border-focus:       #C5A059; /* Zari Gold Focus Ring */

  /* Text & Readability Tokens (WCAG 2.2 AA / AAA) */
  --color-text-primary:       #1C1917; /* Charcoal Slate (16.5:1 on Ivory) */
  --color-text-secondary:     #4B5563; /* Warm Slate Secondary Copy */
  --color-text-muted:         #57534E; /* Accessible Muted Metadata (>4.6:1) */
  --color-text-inverse:       #FFFFFF; /* Pure White on Maroon/Green */

  /* Semantic Feedback Tokens */
  --color-feedback-success:   #15803D; /* Verified Barcode / Saved */
  --color-feedback-warning:   #B45309; /* Retake / Torch Active */
  --color-feedback-error:     #B91C1C; /* Duplicate / Invalid Barcode */
}
```

---

## 3. Typography & Fluid Font Scale
- **Display / Editorial Brand Header:** `"Cormorant Garamond", "Cinzel", "Playfair Display", Georgia, serif`
- **UI Controls & High-Legibility Body:** `"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif`
- **Monospace Barcode & SKU Readouts:** `"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace`

---

## 4. Spatial Scale & Elevation
- **8-Point Spatial System:** `--space-1` (`4px`) through `--space-16` (`64px`).
- **Border Radii:** `6px` for buttons & inputs, `8px` for cards & modals, `9999px` for status pills.
- **Tactile Borders:** `1px solid var(--color-border-subtle)` with subtle warm ambient elevation `0 6px 20px rgba(28, 25, 23, 0.07)`.

---

## 5. Master Component Contracts
- **Top-Level Mode Switcher:** Segmented 2-tab bar switching immediately between **Photo + Barcode** (2-Step Catalog Mode) and **Rapid Barcode** (Inventory List Mode).
- **Interactive Operator Pill:** Header badge displaying the active operator name; tapping opens the operator name modal for instant handoffs.
- **Camera Viewfinder HUD:** 4:3 hardware viewfinder with corner brackets, 44×44px zoom/lens controls, and Step-2 floating thumbnail preview with 1-tap Retake.
- **Sticky Bottom Conversion/Action Bar:** Frosted Warm Ivory bar (`backdrop-filter: blur(12px)`) housing primary export actions (**Zip & Share** or **.TXT / .CSV / Excel**).

---

## 6. Accessibility & Responsiveness Mandates
- **Touch Targets:** Minimum `44 × 44 px` on coarse pointers (`@media (pointer: coarse)`), `24 × 24 px` minimum on fine pointers (`WCAG 2.5.8` & `2.5.5`).
- **Focus Not Obscured:** `scroll-padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px))` on `html` (`WCAG 2.4.11`).
- **Keyboard Focus Ring:** `2px solid var(--color-brand-accent)` with `2px` offset.
- **Motion Safety:** Respects `@media (prefers-reduced-motion: reduce)`.
