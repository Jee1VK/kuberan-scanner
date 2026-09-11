# Kuberan Scanner 📱

A Progressive Web App (PWA) for scanning product barcodes, capturing photos, renaming them by barcode number, and sharing as a zip file.

## ✨ Features

- **📷 Barcode Scanning** — Auto-detect product barcodes using your phone's camera (Chrome Android)
- **✏️ Manual Entry** — Type barcode numbers manually on any device
- **🏷️ Auto-Rename** — Photos are automatically named by barcode (e.g., `8901234567890.jpg`)
- **📦 Zip & Share** — Create a zip file and share via WhatsApp, Email, Google Drive, etc.
- **💾 Auto-Save** — Photos persist across sessions using IndexedDB
- **📲 Installable** — Add to home screen for native app experience
- **🔌 Offline Ready** — Works without internet after first visit
- **🔦 Flash Support** — Toggle flashlight for low-light scanning

## 🚀 Quick Start

### Option 1: GitHub Pages (Recommended)

1. Fork this repository
2. Go to **Settings → Pages**
3. Set source to **Deploy from branch** → `main` → `/ (root)`
4. Visit `https://yourusername.github.io/kuberan-scanner/`
5. On your phone, tap **"Install"** or **"Add to Home Screen"**

### Option 2: Local Development

```bash
# Any static file server will work
npx serve .
# or
python -m http.server 8080
```

> **Note:** Camera access requires HTTPS or `localhost`. GitHub Pages provides HTTPS automatically.

## 📱 How to Use

1. **Open the app** on your phone
2. **Allow camera access** when prompted
3. **Point at a product barcode** and tap **"Scan & Capture"**
4. The photo is captured and renamed with the barcode number
5. Repeat for more products
6. Tap **"Zip & Share"** to create a zip and share it

## 🔧 Browser Support

| Feature | Chrome Android | Safari iOS | Chrome Desktop |
|---------|---------------|------------|----------------|
| Camera | ✅ | ✅ | ✅ |
| Auto-scan barcode | ✅ | ❌ (manual entry) | ✅ |
| Zip & Share | ✅ (native share) | ✅ (download) | ✅ (download) |
| Install as app | ✅ | ✅ (Add to Home) | ✅ |
| Offline mode | ✅ | ✅ | ✅ |
| Flash/torch | ✅ | ❌ | ❌ |

## 📁 Project Structure

```
kuberan-scanner/
├── index.html      # Main app page
├── style.css       # Mobile-first dark theme
├── app.js          # Application logic (gallery, zip, share, IndexedDB)
├── scanner.js      # Camera & barcode detection module
├── manifest.json   # PWA manifest (installability)
├── sw.js           # Service worker (offline caching)
├── README.md       # This file
└── icons/
    ├── icon.svg    # Vector app icon
    ├── icon-192.png # App icon 192×192
    └── icon-512.png # App icon 512×512
```

## 🔑 Supported Barcode Formats

EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR Code, Codabar, ITF

## 📝 Customization

### Change App Name
Edit `manifest.json` and update the `<title>` in `index.html`.

### Change Theme Colors
Edit the CSS custom properties at the top of `style.css`:
```css
:root {
  --primary: #6366F1;    /* Main accent color */
  --bg: #0F172A;          /* Background color */
  --surface: #1E293B;     /* Card/panel color */
}
```

### Change JPEG Quality
Edit `CONFIG.JPEG_QUALITY` in `app.js` (0.0 – 1.0, default: 0.92).

## 🏗️ Generating PNG Icons

The app includes an SVG icon. For maximum compatibility, also create PNG versions:

1. Open `icons/icon.svg` in a browser
2. Take a screenshot and crop to square
3. Resize to 192×192 and 512×512
4. Save as `icons/icon-192.png` and `icons/icon-512.png`

Or use an online tool like [RealFaviconGenerator](https://realfavicongenerator.net/).

## 📄 License

MIT License — free to use, modify, and distribute.
