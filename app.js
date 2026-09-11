/**
 * Kuberan Scanner — Main Application Logic
 *
 * Features:
 *  1. Camera -> Barcode Detection -> Photo Capture -> Auto-rename
 *  2. Audio & Haptic Feedback (Beep chime + Shutter sound + Haptics)
 *  3. Visual Shutter Flash Effect
 *  4. Full-Screen Photo Inspector Lightbox (Zoom, Rotate 90°, Retake, Delete)
 *  5. Compression Quality Settings (Compact ~60KB, Balanced ~120KB, High ~250KB)
 *  6. Gallery Search & Duplicate Barcode Alerts
 *  7. Camera Zoom Toggle (1x, 2x) & Lens Switcher
 *  8. Zip creation with JSZip & Native Web Share / Download
 *  9. IndexedDB persistence across browser sessions
 */

/* ═══════════════════════════════════════════
   Configuration & Quality Presets
   ═══════════════════════════════════════════ */
const CONFIG = {
  DB_NAME: 'KuberanScannerDB',
  DB_VERSION: 1,
  STORE_NAME: 'photos',
  SCAN_TIMEOUT_MS: 5000,
  SCAN_INTERVAL_MS: 150,
  TOAST_DURATION_MS: 3000,
  ZIP_PREFIX: 'KuberanScanner',
  PRESETS: {
    compact:  { quality: 0.65, maxDimension: 960 },   // ~60 KB
    balanced: { quality: 0.75, maxDimension: 1200 },  // ~120 KB (Default)
    high:     { quality: 0.88, maxDimension: 1600 }   // ~250 KB
  }
};

/* ═══════════════════════════════════════════
   User Settings (persisted in localStorage)
   ═══════════════════════════════════════════ */
let settings = {
  compression: 'balanced',
  sound: true,
  shutterSound: true,
  vibration: true
};

function loadSettings() {
  try {
    const saved = localStorage.getItem('kuberan_scanner_settings');
    if (saved) {
      settings = { ...settings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('[Settings] Failed to parse saved settings:', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem('kuberan_scanner_settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('[Settings] Failed to persist settings:', e);
  }
}

function getActiveCompressionParams() {
  return CONFIG.PRESETS[settings.compression] || CONFIG.PRESETS.balanced;
}

/* ═══════════════════════════════════════════
   State
   ═══════════════════════════════════════════ */
let scanner = null;
let photos = [];
let db = null;
let pendingPhotoBlob = null;
let retakeTargetId = null;     // Non-null if currently retaking an existing photo
let activeLightboxPhoto = null;// Photo currently viewed in lightbox
let deferredInstallPrompt = null;
let searchQuery = '';
let audioCtx = null;

/* ═══════════════════════════════════════════
   DOM References
   ═══════════════════════════════════════════ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Header
  photoStats:       $('#photo-stats'),
  photoCount:       $('#photo-count'),
  btnOpenSettings:  $('#btn-open-settings'),

  // Camera
  cameraFeed:       $('#camera-feed'),
  scanCanvas:       $('#scan-canvas'),
  scanFrame:        $('#scan-frame'),
  scanHint:         $('#scan-hint'),
  scanStatus:       $('#scan-status'),
  cameraError:      $('#camera-error'),
  cameraErrorMsg:   $('#camera-error-msg'),
  cameraContainer:  $('#camera-container'),
  shutterFlash:     $('#shutter-flash'),
  zoomButtons:      $$('.zoom-btn'),
  btnSwitchCamera:  $('#btn-switch-camera'),
  btnScan:          $('#btn-scan'),
  btnFlash:         $('#btn-flash'),
  btnManualEntry:   $('#btn-manual-entry'),
  btnRetryCamera:   $('#btn-retry-camera'),

  // Gallery
  gallerySection:   $('#gallery-section'),
  gallery:          $('#photo-gallery'),
  galleryCount:     $('#gallery-count'),
  emptyState:       $('#empty-state'),
  gallerySearchWrap:$('#gallery-search-wrap'),
  gallerySearch:    $('#gallery-search'),

  // Action Bar
  actionBar:        $('#action-bar'),
  btnZipShare:      $('#btn-zip-share'),
  btnClear:         $('#btn-clear'),

  // Lightbox
  lightbox:         $('#photo-lightbox'),
  lightboxImg:      $('#lightbox-img'),
  lightboxTitle:    $('#lightbox-title'),
  lightboxSize:     $('#lightbox-size'),
  btnLightboxClose: $('#btn-lightbox-close'),
  btnLightboxRotate:$('#btn-lightbox-rotate'),
  btnLightboxRetake:$('#btn-lightbox-retake'),
  btnLightboxDelete:$('#btn-lightbox-delete'),

  // Settings Modal
  settingsOverlay:  $('#modal-settings-overlay'),
  btnSettingsClose: $('#btn-settings-close'),
  btnSaveSettings:  $('#btn-save-settings'),
  radioCompression: $$('input[name="compression"]'),
  chkSound:         $('#setting-sound'),
  chkShutterSound:  $('#setting-shutter-sound'),
  chkVibration:     $('#setting-vibration'),

  // Manual Entry Modal
  modalOverlay:     $('#modal-overlay'),
  manualBarcode:    $('#manual-barcode'),
  btnModalSave:     $('#btn-modal-save'),
  btnModalSkip:     $('#btn-modal-skip'),

  // Confirm Clear Modal
  confirmOverlay:   $('#modal-confirm-overlay'),
  btnConfirmClear:  $('#btn-confirm-clear'),
  btnConfirmCancel: $('#btn-confirm-cancel'),

  // Install
  installBanner:    $('#install-banner'),
  btnInstall:       $('#btn-install'),
  btnDismissInstall:$('#btn-dismiss-install'),

  // Toast & Loading
  toast:            $('#toast'),
  loadingOverlay:   $('#loading-overlay'),
  loadingText:      $('#loading-text'),
};

/* ═══════════════════════════════════════════
   Audio & Haptic Feedback Engine
   ═══════════════════════════════════════════ */
function getAudioCtx() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play authentic two-tone scanner beep on barcode recognition.
 */
function playBarcodeBeep() {
  if (!settings.sound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Frequency chime from 1760Hz (A6) to 2200Hz (C#7)
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(1760, now);
    osc.frequency.exponentialRampToValueAtTime(2200, now + 0.08);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.09);
  } catch (e) {
    console.debug('[Audio] Beep failed:', e);
  }
}

/**
 * Play camera shutter snap sound on photo capture.
 */
function playShutterSound() {
  if (!settings.shutterSound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.06; // 60ms click
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
  } catch (e) {
    console.debug('[Audio] Shutter sound failed:', e);
  }
}

/**
 * Trigger phone vibration.
 */
function triggerHaptic(pattern = [60, 40, 60]) {
  if (!settings.vibration) return;
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.debug('[Haptics] Vibration failed:', e);
    }
  }
}

/**
 * Visual shutter flash over the viewfinder screen.
 */
function triggerShutterFlash() {
  dom.shutterFlash.classList.add('flash');
  setTimeout(() => {
    dom.shutterFlash.classList.remove('flash');
  }, 120);
}

/* ═══════════════════════════════════════════
   Initialization
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  applySettingsToUI();

  // Initialize IndexedDB
  db = await openDB();

  // Load photos
  photos = await loadPhotos();
  renderGallery();
  updateStats();

  // Initialize camera
  await initCamera();

  // Bind all event listeners
  bindEvents();

  // PWA Install prompt listener
  handleInstallPrompt();
});

/* ── Camera initialization ── */
async function initCamera() {
  try {
    scanner = new BarcodeScanner(dom.cameraFeed, dom.scanCanvas);
    await scanner.init();

    if (!scanner.hasNativeScanning()) {
      dom.scanHint.textContent = 'Tap "Scan & Capture" to take photo';
    }

    // Show lens switcher if multiple cameras are available
    if (scanner.availableCameras && scanner.availableCameras.length > 1) {
      dom.btnSwitchCamera.hidden = false;
    } else {
      dom.btnSwitchCamera.hidden = true;
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
  // Capture button
  dom.btnScan.addEventListener('click', handleScanAndCapture);

  // Flash / Torch button
  dom.btnFlash.addEventListener('click', handleFlashToggle);

  // Manual entry button
  dom.btnManualEntry.addEventListener('click', () => captureAndPromptManual());

  // Retry camera button
  dom.btnRetryCamera.addEventListener('click', initCamera);

  // Camera switch button
  dom.btnSwitchCamera.addEventListener('click', async () => {
    if (!scanner) return;
    dom.btnSwitchCamera.disabled = true;
    try {
      await scanner.switchCamera();
      showToast('Camera switched');
    } catch (e) {
      showToast('Failed to switch camera', 'error');
    } finally {
      dom.btnSwitchCamera.disabled = false;
    }
  });

  // Zoom buttons
  dom.zoomButtons.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const zoomVal = parseFloat(e.target.dataset.zoom) || 1.0;
      if (scanner) {
        await scanner.setZoom(zoomVal);
        dom.zoomButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }
    });
  });

  // Gallery item click (delegate to open lightbox or delete)
  dom.gallery.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete');
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.dataset.id;
      deletePhoto(id);
      return;
    }

    const photoCard = e.target.closest('.photo-item');
    if (photoCard) {
      const id = photoCard.dataset.id;
      const targetPhoto = photos.find(p => p.id === id);
      if (targetPhoto) {
        openLightbox(targetPhoto);
      }
    }
  });

  // Gallery search filter
  dom.gallerySearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderGallery();
  });

  // Action Bar buttons
  dom.btnZipShare.addEventListener('click', handleZipAndShare);
  dom.btnClear.addEventListener('click', () => { dom.confirmOverlay.hidden = false; });
  dom.btnConfirmClear.addEventListener('click', () => {
    clearAllPhotos();
    dom.confirmOverlay.hidden = true;
  });
  dom.btnConfirmCancel.addEventListener('click', () => { dom.confirmOverlay.hidden = true; });

  // Lightbox controls
  dom.btnLightboxClose.addEventListener('click', closeLightbox);
  dom.lightbox.addEventListener('click', (e) => {
    if (e.target === dom.lightbox || e.target.classList.contains('lightbox-body')) {
      closeLightbox();
    }
  });
  dom.btnLightboxRotate.addEventListener('click', handleLightboxRotate);
  dom.btnLightboxRetake.addEventListener('click', handleLightboxRetake);
  dom.btnLightboxDelete.addEventListener('click', handleLightboxDelete);

  // Settings Modal controls
  dom.btnOpenSettings.addEventListener('click', openSettingsModal);
  dom.btnSettingsClose.addEventListener('click', closeSettingsModal);
  dom.btnSaveSettings.addEventListener('click', handleSaveSettings);
  dom.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === dom.settingsOverlay) closeSettingsModal();
  });

  // Manual Entry Modal
  dom.btnModalSave.addEventListener('click', handleModalSave);
  dom.btnModalSkip.addEventListener('click', () => {
    pendingPhotoBlob = null;
    retakeTargetId = null;
    closeModal();
  });
  dom.manualBarcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleModalSave();
  });
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) {
      pendingPhotoBlob = null;
      retakeTargetId = null;
      closeModal();
    }
  });

  // PWA Install banner
  dom.btnInstall.addEventListener('click', handleInstall);
  dom.btnDismissInstall.addEventListener('click', () => {
    dom.installBanner.hidden = true;
  });

  // Keyboard Escape listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeSettingsModal();
      closeModal();
      dom.confirmOverlay.hidden = true;
    }
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

  dom.btnScan.disabled = true;
  dom.scanFrame.classList.add('scanning');
  dom.scanStatus.hidden = false;

  let barcode = null;

  // Auto barcode detection if supported
  if (scanner.hasNativeScanning()) {
    barcode = await scanner.scanUntilFound(
      (result) => {
        dom.scanFrame.classList.remove('scanning');
        dom.scanFrame.classList.add('success');
        playBarcodeBeep();
        triggerHaptic([60, 40, 60]);
      },
      CONFIG.SCAN_INTERVAL_MS,
      CONFIG.SCAN_TIMEOUT_MS
    );
  }

  // Visual shutter flash and shutter sound
  triggerShutterFlash();
  playShutterSound();
  triggerHaptic(40);

  // Capture photo with current compression settings
  const { quality, maxDimension } = getActiveCompressionParams();
  const blob = await scanner.capturePhoto(quality, maxDimension);

  // Reset scan frame
  dom.scanFrame.classList.remove('scanning', 'success');
  dom.scanStatus.hidden = true;
  dom.btnScan.disabled = false;

  if (!blob) {
    showToast('Failed to capture photo', 'error');
    return;
  }

  // If we are currently retaking a photo:
  if (retakeTargetId) {
    await replaceExistingPhoto(retakeTargetId, blob);
    retakeTargetId = null;
    return;
  }

  if (barcode) {
    // Check for duplicate barcode alert
    const isDuplicate = photos.some(p => p.barcode === barcode.value);
    await savePhoto(barcode.value, blob);

    if (isDuplicate) {
      showToast(`⚠️ Duplicate! Saved as additional photo (${formatSize(blob.size)})`, 'warning');
    } else {
      showToast(`✓ Saved: ${barcode.value} (${formatSize(blob.size)})`, 'success');
    }
  } else {
    // Prompt manual entry
    pendingPhotoBlob = blob;
    openManualEntryModal();
  }
}

async function captureAndPromptManual() {
  if (!scanner || !scanner.isReady()) {
    showToast('Camera not ready', 'error');
    return;
  }

  triggerShutterFlash();
  playShutterSound();
  triggerHaptic(40);

  const { quality, maxDimension } = getActiveCompressionParams();
  const blob = await scanner.capturePhoto(quality, maxDimension);

  if (!blob) {
    showToast('Failed to capture photo', 'error');
    return;
  }

  // If retaking an existing photo
  if (retakeTargetId) {
    await replaceExistingPhoto(retakeTargetId, blob);
    retakeTargetId = null;
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

  const isDuplicate = photos.some(p => p.barcode === barcode);
  const blob = pendingPhotoBlob;
  pendingPhotoBlob = null;
  closeModal();

  await savePhoto(barcode, blob);

  if (isDuplicate) {
    showToast(`⚠️ Duplicate! Saved as additional photo (${formatSize(blob.size)})`, 'warning');
  } else {
    showToast(`✓ Saved: ${barcode} (${formatSize(blob.size)})`, 'success');
  }
}

/* ═══════════════════════════════════════════
   Photo Management & Persistence
   ═══════════════════════════════════════════ */
async function savePhoto(barcode, blob) {
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
  await persistPhoto(photo);
  renderGallery();
  updateStats();
}

async function replaceExistingPhoto(id, newBlob) {
  const target = photos.find(p => p.id === id);
  if (!target) return;

  if (target._blobUrl) URL.revokeObjectURL(target._blobUrl);
  target.blob = newBlob;
  target.size = newBlob.size;
  target._blobUrl = URL.createObjectURL(newBlob);
  target.timestamp = Date.now();

  await persistPhoto(target);
  renderGallery();
  updateStats();
  showToast(`✓ Photo replaced (${formatSize(newBlob.size)})`, 'success');
}

async function deletePhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (photo && photo._blobUrl) {
    URL.revokeObjectURL(photo._blobUrl);
  }
  photos = photos.filter(p => p.id !== id);
  await removePhoto(id);
  renderGallery();
  updateStats();
  showToast('Photo deleted');
}

async function clearAllPhotos() {
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
   Gallery Rendering & Search
   ═══════════════════════════════════════════ */
function renderGallery() {
  const hasPhotos = photos.length > 0;

  dom.emptyState.hidden = hasPhotos;
  dom.gallery.hidden = !hasPhotos;
  dom.actionBar.hidden = !hasPhotos;
  dom.gallerySearchWrap.hidden = !hasPhotos;
  dom.btnZipShare.disabled = !hasPhotos;
  dom.btnClear.disabled = !hasPhotos;

  if (!hasPhotos) {
    dom.gallery.innerHTML = '';
    return;
  }

  // Filter photos by search query
  const displayedPhotos = searchQuery
    ? photos.filter(p => p.barcode.toLowerCase().includes(searchQuery) || p.fileName.toLowerCase().includes(searchQuery))
    : photos;

  if (displayedPhotos.length === 0) {
    dom.gallery.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted);">
        No photos matching "${escapeHtml(searchQuery)}"
      </div>
    `;
    return;
  }

  dom.gallery.innerHTML = displayedPhotos.map(photo => {
    if (!photo._blobUrl) {
      photo._blobUrl = URL.createObjectURL(photo.blob);
    }

    return `
      <div class="photo-item" data-id="${photo.id}" title="Tap to inspect">
        <img src="${photo._blobUrl}" alt="${photo.barcode}" loading="lazy">
        <div class="photo-label">
          <span class="photo-name">${escapeHtml(photo.fileName)}</span>
          <span class="photo-size">${formatSize(photo.size)}</span>
        </div>
        <button class="btn-delete" data-id="${photo.id}" aria-label="Delete ${photo.fileName}">×</button>
      </div>
    `;
  }).join('');
}

function updateStats() {
  const count = photos.length;
  const totalBytes = photos.reduce((acc, p) => acc + (p.size || 0), 0);
  dom.photoStats.hidden = count === 0;
  dom.photoCount.textContent = count;
  dom.galleryCount.textContent = count > 0 ? `(${count} • ${formatSize(totalBytes)})` : '';
}

/* ═══════════════════════════════════════════
   Full-Screen Photo Lightbox / Inspector
   ═══════════════════════════════════════════ */
function openLightbox(photo) {
  activeLightboxPhoto = photo;
  dom.lightboxTitle.textContent = photo.fileName;
  dom.lightboxSize.textContent = `${formatSize(photo.size)} • ${new Date(photo.timestamp).toLocaleTimeString()}`;
  dom.lightboxImg.src = photo._blobUrl;
  dom.lightboxImg.style.transform = '';
  dom.lightbox.hidden = false;
}

function closeLightbox() {
  dom.lightbox.hidden = true;
  activeLightboxPhoto = null;
}

/**
 * Rotate photo 90 degrees clockwise and re-save in IndexedDB.
 */
async function handleLightboxRotate() {
  if (!activeLightboxPhoto) return;

  dom.btnLightboxRotate.disabled = true;
  showToast('Rotating photo…');

  try {
    const rotatedBlob = await rotateBlob90(activeLightboxPhoto.blob);
    if (!rotatedBlob) throw new Error('Rotation failed');

    // Update active photo object
    if (activeLightboxPhoto._blobUrl) URL.revokeObjectURL(activeLightboxPhoto._blobUrl);
    activeLightboxPhoto.blob = rotatedBlob;
    activeLightboxPhoto.size = rotatedBlob.size;
    activeLightboxPhoto._blobUrl = URL.createObjectURL(rotatedBlob);

    // Update lightbox view
    dom.lightboxImg.src = activeLightboxPhoto._blobUrl;
    dom.lightboxSize.textContent = `${formatSize(rotatedBlob.size)} • ${new Date(activeLightboxPhoto.timestamp).toLocaleTimeString()}`;

    // Persist changes
    await persistPhoto(activeLightboxPhoto);
    renderGallery();
    updateStats();
    showToast('Photo rotated and saved!', 'success');
  } catch (err) {
    console.error('[Lightbox] Rotate failed:', err);
    showToast('Failed to rotate photo', 'error');
  } finally {
    dom.btnLightboxRotate.disabled = false;
  }
}

function handleLightboxRetake() {
  if (!activeLightboxPhoto) return;
  retakeTargetId = activeLightboxPhoto.id;
  closeLightbox();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast(`Retaking photo for ${activeLightboxPhoto.barcode}. Tap "Scan & Capture"`);
}

function handleLightboxDelete() {
  if (!activeLightboxPhoto) return;
  const idToDelete = activeLightboxPhoto.id;
  closeLightbox();
  deletePhoto(idToDelete);
}

/**
 * Rotate an image blob 90 degrees clockwise using an offscreen canvas.
 */
function rotateBlob90(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const { quality } = getActiveCompressionParams();
      canvas.toBlob(resolve, 'image/jpeg', quality);
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    img.src = url;
  });
}

/* ═══════════════════════════════════════════
   Settings Modal Handling
   ═══════════════════════════════════════════ */
function openSettingsModal() {
  applySettingsToUI();
  dom.settingsOverlay.hidden = false;
}

function closeSettingsModal() {
  dom.settingsOverlay.hidden = true;
}

function applySettingsToUI() {
  dom.radioCompression.forEach((radio) => {
    radio.checked = radio.value === settings.compression;
  });
  dom.chkSound.checked = !!settings.sound;
  dom.chkShutterSound.checked = !!settings.shutterSound;
  dom.chkVibration.checked = !!settings.vibration;
}

function handleSaveSettings() {
  const selectedRadio = Array.from(dom.radioCompression).find(r => r.checked);
  if (selectedRadio) {
    settings.compression = selectedRadio.value;
  }
  settings.sound = dom.chkSound.checked;
  settings.shutterSound = dom.chkShutterSound.checked;
  settings.vibration = dom.chkVibration.checked;

  saveSettings();
  closeSettingsModal();
  showToast('Settings saved!', 'success');
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
   Zip & Share
   ═══════════════════════════════════════════ */
async function handleZipAndShare() {
  if (photos.length === 0) return;

  dom.loadingText.textContent = 'Creating zip archive…';
  dom.loadingOverlay.hidden = false;

  try {
    const zip = new JSZip();

    // Add all photos
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

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFileName = `${CONFIG.ZIP_PREFIX}_${timestamp}.zip`;
    const zipFile = new File([zipBlob], zipFileName, { type: 'application/zip' });

    // Try Web Share API first
    if (navigator.canShare && navigator.canShare({ files: [zipFile] })) {
      dom.loadingOverlay.hidden = true;
      try {
        await navigator.share({
          title: 'Kuberan Scanner Photos',
          text: `${photos.length} product photos (${formatSize(zipBlob.size)})`,
          files: [zipFile]
        });
        showToast('Shared successfully!', 'success');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[App] Share failed, falling back to download:', err);
        }
      }
    }

    // Fallback: Download file
    dom.loadingOverlay.hidden = true;
    downloadBlob(zipBlob, zipFileName);
    showToast(`Downloaded: ${zipFileName}`, 'success');

  } catch (err) {
    console.error('[App] Zip creation failed:', err);
    showToast('Failed to create zip archive', 'error');
  } finally {
    dom.loadingOverlay.hidden = true;
  }
}

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
  return new Promise((resolve) => {
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
      resolve(null);
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
    tx.onerror = () => resolve();
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
    setTimeout(() => {
      dom.installBanner.hidden = false;
    }, 2000);
  });

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
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
