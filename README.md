# Kuberan Scanner 📱

A fast, lightweight Progressive Web App (PWA) designed for retail, warehouse, and catalog photography. Scan product barcodes, capture photos, auto-rename them by barcode/product number, compress them to lightweight KB sizes, and share them as a ZIP archive.

Live Web App: **[https://jee1vk.github.io/kuberan-scanner/](https://jee1vk.github.io/kuberan-scanner/)**

---

## ✨ Features

- **📷 Barcode Scanning** — Auto-detect product barcodes using your phone's camera (Chrome Android)
- **✏️ Manual Barcode Entry** — Type barcode/product numbers manually when barcodes are damaged or unreadable
- **🏷️ Auto-Rename** — Photos are automatically renamed using the barcode (e.g., `8901234567890.jpg` or `8901234567890_002.jpg` for duplicates)
- **🔊 Audio Chime & Haptic Vibration** — Authentic warehouse scanner beep (Web Audio API) and physical vibration upon barcode recognition
- **📸 Shutter Flash & Sound** — Viewfinder screen flashes white for 120ms with an acoustic camera snap sound
- **🔍 Full-Screen Photo Inspector (Lightbox)** — Tap any photo in the gallery to inspect in high resolution:
  - **Rotate 90°:** Fix sideways photos on the spot
  - **Retake:** Directly replace a blurry photo
  - **Delete:** Remove individual photos
- **🎛️ Compression Quality Picker** — Customize photo weight in Settings:
  - **Compact (~60 KB):** Smallest size, minimal data usage
  - **Balanced (~120 KB - Default):** Sharp detail while keeping zip archives lightweight
  - **High (~250 KB):** High definition for e-commerce catalogs
- **🔎 Live Gallery Search** — Quickly filter photos by typing barcode digits or filenames
- **⚠️ Duplicate Barcode Alerts** — Warns you when a product barcode was already photographed
- **🔍 Camera Zoom (1x / 2x)** — Quick zoom pills to capture small product labels without moving your phone
- **🔄 Multi-Camera Lens Switcher** — Switch between available rear cameras (standard, wide, macro)
- **📦 Zip & Share** — Compress all photos into a timestamped ZIP archive and share directly via WhatsApp, Gmail, Google Drive, or standard download
- **💾 Offline & Session Persistence** — Photos and preferences survive page refreshes using IndexedDB & localStorage
- **📲 Installable PWA** — Add to home screen for a full-screen, native mobile app experience without an app store

---

## 🚀 Deployment & Installation

### Option 1: GitHub Pages (Free Hosting)

1. Fork or push this repository to GitHub
2. Go to **Settings → Pages**
3. Under **Build and deployment**, set Source to **Deploy from a branch** → `main` → `/ (root)`
4. Visit `https://<your-username>.github.io/kuberan-scanner/`
5. On your phone:
   - **Chrome Android:** Tap the **Install** banner or menu (⋮) → **Install app** / **Add to Home screen**
   - **iPhone Safari:** Tap Share (square with arrow) → **Add to Home Screen**

### Option 2: Local Development

```bash
# Serve with any static server
npx serve .
# or
python -m http.server 8080
```

> **Note:** Camera access in modern browsers requires **HTTPS** or `localhost`. GitHub Pages provides HTTPS automatically.

---

## 📱 User Guide

1. **Open the app** on your mobile phone and allow camera permission.
2. **Point camera at a barcode** and tap **Scan & Capture**:
   - When detected, you'll hear a scanner beep and feel a vibration.
   - The photo is saved and labeled with the barcode (e.g. `8901234567890.jpg`).
3. **If no barcode is detected**, the manual entry dialog appears so you can type the product number.
4. **Tap any thumbnail** in the gallery to view full-screen, rotate 90°, or retake.
5. **Tap "Zip & Share"** to compress all photos into a ZIP archive and send it via WhatsApp, email, or save locally.

---

## 🔧 Browser Compatibility

| Feature | Chrome Android | Safari iOS | Chrome Desktop | Edge Desktop |
|---|:---:|:---:|:---:|:---:|
| Camera Stream | ✅ | ✅ | ✅ | ✅ |
| Auto Barcode Detection | ✅ (Native) | ❌ (Manual entry) | ✅ | ✅ |
| Audio Beep & Shutter Sound | ✅ | ✅ | ✅ | ✅ |
| Haptic Vibration | ✅ | ❌ (iOS Web limitation) | ❌ | ❌ |
| Zoom (1x / 2x) | ✅ | ✅ (Crop zoom) | ✅ | ✅ |
| Camera Switching | ✅ | ✅ | ✅ | ✅ |
| Photo Lightbox & Rotate | ✅ | ✅ | ✅ | ✅ |
| Web Share (ZIP) | ✅ (Native Share) | ✅ (Download) | ✅ (Download) | ✅ (Download) |
| Offline PWA Support | ✅ | ✅ | ✅ | ✅ |

---

## 📁 File Structure

```
kuberan-scanner/
├── index.html        # Main app UI (viewfinder, gallery, modals, lightbox, settings)
├── style.css         # Dark theme mobile-first styles and animations
├── app.js            # Core application logic (capture, gallery, audio, settings, zip)
├── scanner.js        # Camera stream, barcode detection, hardware/software zoom
├── manifest.json     # PWA manifest for home-screen installation
├── sw.js             # Service worker (offline caching & background sync)
├── README.md         # Documentation & user guide
└── icons/
    ├── icon.svg      # Scalable vector app icon
    ├── icon-192.png  # 192x192 PNG app icon
    └── icon-512.png  # 512x512 PNG app icon
```

---

## 🔑 Supported Barcode Formats

- **Retail:** EAN-13, EAN-8, UPC-A, UPC-E
- **Industrial / Logistics:** Code 128, Code 39, Codabar, ITF
- **2D Codes:** QR Code

---

## 📄 License

MIT License — free for commercial and personal use.
