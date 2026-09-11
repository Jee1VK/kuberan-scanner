# Kuberan Scanner 📱

A fast, lightweight Progressive Web App (PWA) designed for retail, warehouse, and catalog photography. 

Live Web App: **[https://jee1vk.github.io/kuberan-scanner/](https://jee1vk.github.io/kuberan-scanner/)**

---

## 🔄 2-Step Product Photography Workflow

The app uses a guided 2-step capture loop for every product:

1. **📸 Step 1: Take Product Photo**
   - Frame the product and tap **Snap Photo**.
   - The photo is captured, compressed into lightweight KB size, and held in memory.
2. **🏷️ Step 2: Scan Barcode**
   - Point the camera at the product's barcode label (or tap the barcode icon to enter manually).
   - Once detected (with audio chime + haptic vibration), the photo is instantly saved as `{barcode}.jpg` (e.g. `8901234567890.jpg`).
3. **🔁 Automatic Next Product Loop**
   - The app automatically transitions right back to **Step 1** so you can immediately photograph your next product without touching any extra buttons!

---

## ✨ Key Features

- **👤 Name Prompt on Open** — Asks for your name every time the app or website is opened.
- **📦 Smart ZIP Naming** — Files are named in a daily series format:
  `{YourName}_{YYYY-MM-DD}_{DailySerial}.zip` (e.g. `Jeevan_2026-09-11_001.zip`, `Jeevan_2026-09-11_002.zip`).
- **📊 Visual Zip Progress Bar** — Live progress bar showing real-time compression percentage (`0%` to `100%`) so you know exactly how the process is going.
- **💬 WhatsApp Sharing** — Directly open WhatsApp to share the generated ZIP archive with photos.
- **🗑️ Manual Clear All** — Data is safely preserved until you choose to tap **Clear All** (with confirmation dialog).
- **🔊 Audio Chime & Haptic Vibration** — Crisp warehouse scanner beep on barcode recognition.
- **📸 Shutter Flash & Click** — Visual 120ms white flash and sound effect on photo capture.
- **🔍 Full-Screen Photo Inspector** — Tap any gallery thumbnail to inspect full resolution, rotate 90°, or delete.
- **🎛️ Compression Presets** — Compact (~60 KB), Balanced (~120 KB), or High (~250 KB) in Settings.
- **🔎 Live Gallery Search** — Instant filter by barcode number or filename.
- **🔍 Camera Zoom & Lens Switching** — 1x/2x zoom and multi-lens toggle for wide/standard cameras.
- **🚫 Strict Duplicate Barcode Protection** — Scanning an already photographed barcode is strictly blocked with a red visual flash, buzzer alarm, and warning toast so every barcode is 100% unique.
- **💾 Offline PWA** — Works offline in warehouse environments and can be installed directly to home screens.

---

## 📱 How to Use

1. **Open the web app** at [https://jee1vk.github.io/kuberan-scanner/](https://jee1vk.github.io/kuberan-scanner/).
2. Enter your **Name** when prompted and tap **Start Scanning**.
3. **Step 1:** Tap **Snap Photo** to photograph the product.
4. **Step 2:** Point at the barcode. The app beeps and saves `{barcode}.jpg`.
5. Repeat for all products.
6. When done, tap **Zip & Share** to see the progress bar compress the photos and send the ZIP via WhatsApp!

---

## 📄 License

MIT License — free for commercial and personal use.
