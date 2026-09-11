/**
 * Kuberan Scanner — Main Application Logic
 *
 * Manages the photo-capture workflow:
 *  1. Camera → scan barcode → capture photo → rename by barcode
 *  2. Gallery management (view, delete)
 *  3. Zip creation and sharing via Web Share API
 *  4. IndexedDB persistence across sessions
 *  5. PWA install prompt handling
 */

/* ═══════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════ */
const CONFIG = {
  DB_NAME: 'KuberanScannerDB',
  DB_VERSION: 1,
  STORE_NAME: 'photos',
  JPEG_QUALITY: 0.92,
  SCAN_TIMEOUT_MS: 5000,     // How long to scan before asking for manual entry
  SCAN_INTERVAL_MS: 150,     // Barcode scan frequency
  TOAST_DURATION_MS: 3000,
  ZIP_PREFIX: 'KuberanScanner'
};

/* ═══════════════════════════════════════════
   State
   ═══════════════════════════════════════════ */
let scanner = null;           // BarcodeScanner instance
let photos = [];              // Array of { id, barcode, fileName, blob, timestamp }
let db = null;                // IndexedDB connection
let pendingPhotoBlob = null;  // Blob waiting for barcode assignment
let deferredInstallPrompt = null; // PWA install prompt

/* ═══════════════════════════════════════════
   DOM References
   ═══════════════════════════════════════════ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Camera
  cameraFeed:     $('#camera-feed'),
  scanCanvas:     $('#scan-canvas'),
  scanFrame:      $('#scan-frame'),
  scanHint:       $('#scan-hint'),
  scanStatus:     $('#scan-status'),
  cameraError:    $('#camera-error'),
  cameraErrorMsg: $('#camera-error-msg'),
  cameraContainer:$('#camera-container'),
  btnScan:        $('#btn-scan'),
  btnFlash:       $('#btn-flash'),
  btnManualEntry: $('#btn-manual-entry'),
  btnRetryCamera: $('#btn-retry-camera'),
  // Gallery
  gallery:        $('#photo-gallery'),
  galleryCount:   $('#gallery-count'),
  emptyState:     $('#empty-state'),
  photoCount:     $('#photo-count'),
  photoStats:     $('#photo-stats'),
  // Actions
  actionBar:      $('#action-bar'),
  btnZipShare:    $('#btn-zip-share'),
  btnClear:       $('#btn-clear'),
  // Manual entry modal
  modalOverlay:   $('#modal-overlay'),
  manualBarcode:  $('#manual-barcode'),
  btnModalSave:   $('#btn-modal-save'),
  btnModalSkip:   $('#btn-modal-skip'),
  // Confirm clear modal
  confirmOverlay: $('#modal-confirm-overlay'),
  btnConfirmClear:$('#btn-confirm-clear'),
  btnConfirmCancel:$('#btn-confirm-cancel'),
  // Install
  installBanner:  $('#install-banner'),
  btnInstall:     $('#btn-install'),
  btnDismissInstall:$('#btn-dismiss-install'),
  // Misc
  toast:          $('#toast'),
  loadingOverlay: $('#loading-overlay'),
  loadingText:    $('#loading-text'),
};

/* ═══════════════════════════════════════════
   Initialization
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Open IndexedDB
  db = await openDB();

  // Load persisted photos
  photos = await loadPhotos();
  renderGallery();
  updateStats();

  // Initialize camera
  await initCamera();

  // Bind events
  bindEvents();

  // Handle PWA install prompt
  handleInstallPrompt();
});

/* ── Camera initialization ── */
async function initCamera() {
  try {
    scanner = new BarcodeScanner(dom.cameraFeed, dom.scanCanvas);
    await scanner.init();

    // Update UI based on native scanning support
    if (!scanner.hasNativeScanning()) {
      dom.scanHint.textContent = 'Tap "Scan & Capture" to take a photo';
    }

    dom.cameraError.hidden = true;
    dom.cameraFeed.hidden = false;
  } catch (err) {
    console.error('[App] Camera init failed:', err);
    dom.cameraError.hidden = false;
    dom.cameraFeed.hidden = true;
    dom.cameraErrorMsg.textContent = err.message;
  }
}

/* ═══════════════════════════════════════════
   Event Binding
   ═══════════════════════════════════════════ */
function bindEvents() {
  // Scan & Capture
  dom.btnScan.addEventListener('click', handleScanAndCapture);

  // Flash toggle
  dom.btnFlash.addEventListener('click', handleFlashToggle);

  // Manual barcode entry button
  dom.btnManualEntry.addEventListener('click', () => {
    captureAndPromptManual();
  });

  // Retry camera
  dom.btnRetryCamera.addEventListener('click', initCamera);

  // Gallery delete (delegated)
  dom.gallery.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      deletePhoto(id);
    }
  });

  // Zip & Share
  dom.btnZipShare.addEventListener('click', handleZipAndShare);

  // Clear All
  dom.btnClear.addEventListener('click', () => {
    dom.confirmOverlay.hidden = false;
  });

  // Confirm clear
  dom.btnConfirmClear.addEventListener('click', () => {
    clearAllPhotos();
    dom.confirmOverlay.hidden = true;
  });

  dom.btnConfirmCancel.addEventListener('click', () => {
    dom.confirmOverlay.hidden = true;
  });

  // Modal: Save barcode
  dom.btnModalSave.addEventListener('click', handleModalSave);

  // Modal: Skip
  dom.btnModalSkip.addEventListener('click', () => {
    pendingPhotoBlob = null;
    closeModal();
  });

  // Modal: Enter key to save
  dom.manualBarcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleModalSave();
  });

  // Close modals on overlay click
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) {
      pendingPhotoBlob = null;
      closeModal();
    }
  });

  dom.confirmOverlay.addEventListener('click', (e) => {
    if (e.target === dom.confirmOverlay) {
      dom.confirmOverlay.hidden = true;
    }
  });

  // Install
  dom.btnInstall.addEventListener('click', handleInstall);
  dom.btnDismissInstall.addEventListener('click', () => {
    dom.installBanner.hidden = true;
  });
}

/* ═══════════════════════════════════════════
   Core Workflow: Scan & Capture
   ═══════════════════════════════════════════ */
async function handleScanAndCapture() {
  if (!scanner || !scanner.isReady()) {
    showToast('Camera not ready. Please allow camera access.', 'error');
    return;
  }

  // Disable button to prevent double-tap
  dom.btnScan.disabled = true;

  // Show scanning state
  dom.scanFrame.classList.add('scanning');
  dom.scanStatus.hidden = false;

  let barcode = null;

  // Attempt automatic barcode detection
  if (scanner.hasNativeScanning()) {
    barcode = await scanner.scanUntilFound(
      (result) => {
        // Visual feedback on detection
        dom.scanFrame.classList.remove('scanning');
        dom.scanFrame.classList.add('success');
      },
      CONFIG.SCAN_INTERVAL_MS,
      CONFIG.SCAN_TIMEOUT_MS
    );
  }

  // Capture photo regardless of barcode result
  const blob = await scanner.capturePhoto(CONFIG.JPEG_QUALITY);

  // Reset scan UI
  dom.scanFrame.classList.remove('scanning', 'success');
  dom.scanStatus.hidden = true;
  dom.btnScan.disabled = false;

  if (!blob) {
    showToast('Failed to capture photo', 'error');
    return;
  }

  if (barcode) {
    // Barcode found — save directly
    await savePhoto(barcode.value, blob);
    showToast(`✓ Saved: ${barcode.value}`, 'success');
  } else {
    // No barcode found — prompt manual entry
    pendingPhotoBlob = blob;
    openManualEntryModal();
  }
}

/* ── Capture photo and go straight to manual entry ── */
async function captureAndPromptManual() {
  if (!scanner || !scanner.isReady()) {
    showToast('Camera not ready', 'error');
    return;
  }

  const blob = await scanner.capturePhoto(CONFIG.JPEG_QUALITY);
  if (!blob) {
    showToast('Failed to capture photo', 'error');
    return;
  }

  pendingPhotoBlob = blob;
  openManualEntryModal();
}

/* ═══════════════════════════════════════════
   Manual Entry Modal
   ═══════════════════════════════════════════ */
function openManualEntryModal() {
  dom.manualBarcode.value = '';
  dom.modalOverlay.hidden = false;
  // Focus input after animation
  setTimeout(() => dom.manualBarcode.focus(), 100);
}

function closeModal() {
  dom.modalOverlay.hidden = true;
  dom.manualBarcode.value = '';
}

async function handleModalSave() {
  const barcode = dom.manualBarcode.value.trim();

  if (!barcode) {
    dom.manualBarcode.focus();
    dom.manualBarcode.style.borderColor = 'var(--danger)';
    setTimeout(() => dom.manualBarcode.style.borderColor = '', 1000);
    return;
  }

  if (!pendingPhotoBlob) {
    closeModal();
    return;
  }

  await savePhoto(barcode, pendingPhotoBlob);
  pendingPhotoBlob = null;
  closeModal();
  showToast(`✓ Saved: ${barcode}`, 'success');
}

/* ═══════════════════════════════════════════
   Flash Toggle
   ═══════════════════════════════════════════ */
async function handleFlashToggle() {
  if (!scanner) return;

  const result = await scanner.toggleTorch();
  if (result === false && !scanner.stream) {
    showToast('Flash not available on this device', 'error');
    return;
  }
  dom.btnFlash.classList.toggle('active', result);
}

/* ═══════════════════════════════════════════
   Photo Management
   ═══════════════════════════════════════════ */

/**
 * Save a photo with the given barcode.
 * Handles duplicate barcodes by appending sequence numbers.
 */
async function savePhoto(barcode, blob) {
  // Generate sequence number for duplicate barcodes
  const existing = photos.filter(p => p.barcode === barcode);
  const seq = existing.length + 1;
  const fileName = seq > 1
    ? `${barcode}_${String(seq).padStart(3, '0')}.jpg`
    : `${barcode}.jpg`;

  const photo = {
    id: generateId(),
    barcode: barcode,
    fileName: fileName,
    blob: blob,
    timestamp: Date.now(),
    size: blob.size
  };

  photos.push(photo);

  // Persist to IndexedDB
  await persistPhoto(photo);

  // Update UI
  renderGallery();
  updateStats();
}

/** Delete a single photo by ID */
async function deletePhoto(id) {
  photos = photos.filter(p => p.id !== id);
  await removePhoto(id);
  renderGallery();
  updateStats();
  showToast('Photo deleted');
}

/** Clear all photos */
async function clearAllPhotos() {
  // Revoke all blob URLs
  photos.forEach(p => {
    if (p._blobUrl) URL.revokeObjectURL(p._blobUrl);
  });

  photos = [];
  await clearAllPersistedPhotos();
  renderGallery();
  updateStats();
  showToast('All photos cleared');
}

/* ═══════════════════════════════════════════
   Gallery Rendering
   ═══════════════════════════════════════════ */
function renderGallery() {
  const hasPhotos = photos.length > 0;

  dom.emptyState.hidden = hasPhotos;
  dom.gallery.hidden = !hasPhotos;
  dom.actionBar.hidden = !hasPhotos;
  dom.btnZipShare.disabled = !hasPhotos;
  dom.btnClear.disabled = !hasPhotos;

  if (!hasPhotos) {
    dom.gallery.innerHTML = '';
    return;
  }

  // Build gallery HTML
  dom.gallery.innerHTML = photos.map(photo => {
    // Create or reuse blob URL
    if (!photo._blobUrl) {
      photo._blobUrl = URL.createObjectURL(photo.blob);
    }

    return `
      <div class="photo-item" data-id="${photo.id}">
        <img src="${photo._blobUrl}" alt="${photo.barcode}" loading="lazy">
        <span class="photo-label" title="${photo.fileName}">${photo.fileName}</span>
        <button class="btn-delete" data-id="${photo.id}" aria-label="Delete ${photo.fileName}">×</button>
      </div>
    `;
  }).join('');
}

/** Update header stats */
function updateStats() {
  const count = photos.length;
  dom.photoStats.hidden = count === 0;
  dom.photoCount.textContent = count;
  dom.galleryCount.textContent = count > 0 ? `(${count})` : '';
}

/* ═══════════════════════════════════════════
   Zip & Share
   ═══════════════════════════════════════════ */
async function handleZipAndShare() {
  if (photos.length === 0) return;

  // Show loading
  dom.loadingText.textContent = 'Creating zip file…';
  dom.loadingOverlay.hidden = false;

  try {
    const zip = new JSZip();

    // Add each photo to the zip
    for (const photo of photos) {
      zip.file(photo.fileName, photo.blob, { binary: true });
    }

    // Generate zip blob
    dom.loadingText.textContent = 'Compressing photos…';
    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (metadata) => {
        const pct = Math.round(metadata.percent);
        dom.loadingText.textContent = `Compressing… ${pct}%`;
      }
    );

    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFileName = `${CONFIG.ZIP_PREFIX}_${timestamp}.zip`;

    // Try Web Share API first
    const zipFile = new File([zipBlob], zipFileName, { type: 'application/zip' });

    if (navigator.canShare && navigator.canShare({ files: [zipFile] })) {
      dom.loadingOverlay.hidden = true;
      try {
        await navigator.share({
          title: 'Kuberan Scanner Photos',
          text: `${photos.length} product photos`,
          files: [zipFile]
        });
        showToast('Shared successfully!', 'success');
        return;
      } catch (err) {
        // User cancelled share or share failed — fall through to download
        if (err.name !== 'AbortError') {
          console.warn('[App] Share failed, falling back to download:', err);
        }
      }
    }

    // Fallback: Download the zip file
    dom.loadingOverlay.hidden = true;
    downloadBlob(zipBlob, zipFileName);
    showToast(`Downloaded: ${zipFileName}`, 'success');

  } catch (err) {
    console.error('[App] Zip creation failed:', err);
    showToast('Failed to create zip file', 'error');
  } finally {
    dom.loadingOverlay.hidden = true;
  }
}

/** Trigger a file download via temporary anchor element */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ═══════════════════════════════════════════
   IndexedDB Persistence
   ═══════════════════════════════════════════ */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
        db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      console.error('[DB] Open failed:', e.target.error);
      resolve(null); // Continue without persistence
    };
  });
}

function loadPhotos() {
  if (!db) return Promise.resolve([]);

  return new Promise((resolve) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readonly');
    const store = tx.objectStore(CONFIG.STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result || [];
      // Sort by timestamp (oldest first)
      results.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
    };

    request.onerror = () => resolve([]);
  });
}

function persistPhoto(photo) {
  if (!db) return Promise.resolve();

  return new Promise((resolve) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(CONFIG.STORE_NAME);
    store.put({
      id: photo.id,
      barcode: photo.barcode,
      fileName: photo.fileName,
      blob: photo.blob,
      timestamp: photo.timestamp,
      size: photo.size
    });
    tx.oncomplete = resolve;
    tx.onerror = () => resolve(); // Don't block on DB errors
  });
}

function removePhoto(id) {
  if (!db) return Promise.resolve();

  return new Promise((resolve) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(CONFIG.STORE_NAME);
    store.delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => resolve();
  });
}

function clearAllPersistedPhotos() {
  if (!db) return Promise.resolve();

  return new Promise((resolve) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(CONFIG.STORE_NAME);
    store.clear();
    tx.oncomplete = resolve;
    tx.onerror = () => resolve();
  });
}

/* ═══════════════════════════════════════════
   PWA Install Prompt
   ═══════════════════════════════════════════ */
function handleInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    // Show install banner after a short delay
    setTimeout(() => {
      dom.installBanner.hidden = false;
    }, 2000);
  });

  // Hide banner once installed
  window.addEventListener('appinstalled', () => {
    dom.installBanner.hidden = true;
    deferredInstallPrompt = null;
    showToast('App installed successfully!', 'success');
  });
}

async function handleInstall() {
  if (!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;

  if (outcome === 'accepted') {
    dom.installBanner.hidden = true;
  }
  deferredInstallPrompt = null;
}

/* ═══════════════════════════════════════════
   Toast Notifications
   ═══════════════════════════════════════════ */
let toastTimeout = null;

function showToast(message, type = '') {
  dom.toast.textContent = message;
  dom.toast.className = 'toast' + (type ? ` ${type}` : '');
  dom.toast.hidden = false;

  // Trigger reflow for animation
  void dom.toast.offsetWidth;
  dom.toast.classList.add('show');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    dom.toast.classList.remove('show');
    setTimeout(() => { dom.toast.hidden = true; }, 300);
  }, CONFIG.TOAST_DURATION_MS);
}

/* ═══════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════ */

/** Generate a unique ID */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Format bytes to human-readable size */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
