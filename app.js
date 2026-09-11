/**
 * Kuberan Scanner — Main Application Logic
 *
 * WORKFLOW: Photo-First, Barcode-Second
 *  Step 1: Snap product photo (held in memory)
 *  Step 2: Scan barcode (auto or manual) → photo saved as {barcode}.jpg
 *  Step 3: Automatically returns to Step 1 for next product
 *
 * ZIP Naming: {UserName}_{Date}_{DailySerial}.zip
 * Manual "Clear All" button (no auto-wipe)
 */

/* ═══════════════════════════════════════════
   Configuration & Quality Presets
   ═══════════════════════════════════════════ */
const CONFIG = {
  DB_NAME: 'KuberanScannerDB',
  DB_VERSION: 1,
  STORE_NAME: 'photos',
  SCAN_TIMEOUT_MS: 8000,
  SCAN_INTERVAL_MS: 150,
  TOAST_DURATION_MS: 3000,
  PRESETS: {
    compact:  { quality: 0.65, maxDimension: 960 },
    balanced: { quality: 0.75, maxDimension: 1200 },
    high:     { quality: 0.88, maxDimension: 1600 }
  }
};

/* ═══════════════════════════════════════════
   Workflow Steps
   ═══════════════════════════════════════════ */
const STEP = {
  PHOTO: 'photo',
  BARCODE: 'barcode'
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
    if (saved) settings = { ...settings, ...JSON.parse(saved) };
  } catch (e) { /* ignore */ }
}

function saveSettings() {
  try {
    localStorage.setItem('kuberan_scanner_settings', JSON.stringify(settings));
  } catch (e) { /* ignore */ }
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
let userName = '';                // Asked every time app opens
let currentStep = STEP.PHOTO;    // Current workflow step
let pendingPhotoBlob = null;     // Photo captured in Step 1, waiting for barcode in Step 2
let previewBlobUrl = null;       // Active blob URL for floating preview in Step 2
let retakeTargetBarcode = null;  // When retaking from lightbox
let activeLightboxPhoto = null;
let deferredInstallPrompt = null;
let searchQuery = '';
let audioCtx = null;

/* ═══════════════════════════════════════════
   DOM References
   ═══════════════════════════════════════════ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Name prompt
  nameOverlay:      $('#modal-name-overlay'),
  formUserName:     $('#form-user-name'),
  inputUserName:    $('#input-user-name'),
  btnNameSubmit:    $('#btn-name-submit'),
  userGreeting:     $('#user-greeting'),

  // Header
  photoStats:       $('#photo-stats'),
  photoCount:       $('#photo-count'),
  btnOpenSettings:  $('#btn-open-settings'),

  // Step Indicator
  stepBadge:        $('#step-badge'),

  // Camera
  cameraFeed:       $('#camera-feed'),
  scanCanvas:       $('#scan-canvas'),
  scanFrame:        $('#scan-frame'),
  scanHint:         $('#scan-hint'),
  scanStatus:       $('#scan-status'),
  scanOverlay:      $('#scan-overlay'),
  cameraError:      $('#camera-error'),
  cameraErrorMsg:   $('#camera-error-msg'),
  cameraContainer:  $('#camera-container'),
  shutterFlash:     $('#shutter-flash'),
  zoomButtons:      $$('.zoom-btn'),
  btnSwitchCamera:  $('#btn-switch-camera'),
  btnAction:        $('#btn-action'),
  btnActionText:    $('#btn-action-text'),
  btnActionIconCamera: $('#btn-action-icon-camera'),
  btnActionIconBarcode: $('#btn-action-icon-barcode'),
  btnFlash:         $('#btn-flash'),
  btnManualEntry:   $('#btn-manual-entry'),
  btnRetryCamera:   $('#btn-retry-camera'),
  photoPreview:     $('#photo-preview-overlay'),
  photoPreviewImg:  $('#photo-preview-img'),
  btnRetakeStep:    $('#btn-retake-step'),

  // Gallery
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
  progressFill:     $('#progress-fill'),
  progressPercent:  $('#progress-percent'),
};

/* ═══════════════════════════════════════════
   Audio & Haptic Feedback Engine
   ═══════════════════════════════════════════ */
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playBarcodeBeep() {
  if (!settings.sound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(1760, now);
    osc.frequency.exponentialRampToValueAtTime(2200, now + 0.08);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch (e) { /* ignore */ }
}

function playErrorTone() {
  if (!settings.sound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.setValueAtTime(160, now + 0.1);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (e) { /* ignore */ }
}

function playShutterSound() {
  if (!settings.shutterSound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.06;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
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
  } catch (e) { /* ignore */ }
}

function triggerHaptic(pattern = [60, 40, 60]) {
  if (!settings.vibration || !('vibrate' in navigator)) return;
  try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

function triggerShutterFlash() {
  dom.shutterFlash.classList.add('flash');
  setTimeout(() => dom.shutterFlash.classList.remove('flash'), 120);
}

/* ═══════════════════════════════════════════
   Initialization
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  applySettingsToUI();

  db = await openDB();
  photos = await loadPhotos();
  renderGallery();
  updateStats();

  // Show name prompt on EVERY app open
  showNamePrompt();

  bindEvents();
  handleInstallPrompt();
});

/* ── Name Prompt (shown every time) ── */
function showNamePrompt() {
  // Pre-fill with last-used name for convenience
  const lastUsed = localStorage.getItem('kuberan_last_name') || '';
  dom.inputUserName.value = lastUsed;
  dom.nameOverlay.hidden = false;
  setTimeout(() => {
    dom.inputUserName.focus();
    dom.inputUserName.select();
  }, 200);
}

function handleNameSubmit() {
  const name = dom.inputUserName.value.trim();
  if (!name) {
    dom.inputUserName.style.borderColor = 'var(--danger)';
    dom.inputUserName.focus();
    setTimeout(() => dom.inputUserName.style.borderColor = '', 1000);
    return;
  }

  userName = name;
  localStorage.setItem('kuberan_last_name', name);
  dom.nameOverlay.hidden = true;
  dom.userGreeting.textContent = name;
  dom.userGreeting.hidden = false;

  // Initialize camera after name is confirmed
  initCamera();
}

/* ── Camera initialization ── */
async function initCamera() {
  try {
    scanner = new BarcodeScanner(dom.cameraFeed, dom.scanCanvas);
    await scanner.init();

    if (!scanner.hasNativeScanning()) {
      dom.scanHint.textContent = 'Manual barcode entry mode';
    }

    if (scanner.availableCameras && scanner.availableCameras.length > 1) {
      dom.btnSwitchCamera.hidden = false;
    }

    dom.cameraError.hidden = true;
    dom.cameraFeed.hidden = false;

    // Start in Step 1 (Photo)
    setStep(STEP.PHOTO);
  } catch (err) {
    console.error('[App] Camera init failed:', err);
    dom.cameraError.hidden = false;
    dom.cameraFeed.hidden = true;
    dom.cameraErrorMsg.textContent = err.message;
  }
}

/* ═══════════════════════════════════════════
   Step Management (Photo → Barcode → Photo…)
   ═══════════════════════════════════════════ */
function setStep(step) {
  currentStep = step;

  if (step === STEP.PHOTO) {
    // Step 1: Take Product Photo
    dom.stepBadge.className = 'step-badge step-photo';
    dom.stepBadge.querySelector('.step-number').textContent = '1';
    dom.stepBadge.querySelector('.step-text').textContent = retakeTargetBarcode 
      ? `Retaking for ${retakeTargetBarcode}`
      : 'Take Product Photo';
    dom.btnActionText.textContent = 'Snap Photo';
    if (dom.btnActionIconCamera) dom.btnActionIconCamera.hidden = false;
    if (dom.btnActionIconBarcode) dom.btnActionIconBarcode.hidden = true;
    dom.btnManualEntry.hidden = true;
    dom.scanOverlay.hidden = true;
    dom.scanStatus.hidden = true;
    dom.scanFrame.classList.remove('scanning', 'success');

    // Clean up preview overlay
    dom.photoPreview.hidden = true;
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      previewBlobUrl = null;
    }
    dom.photoPreviewImg.src = '';

  } else if (step === STEP.BARCODE) {
    // Step 2: Scan Barcode
    dom.stepBadge.className = 'step-badge step-barcode';
    dom.stepBadge.querySelector('.step-number').textContent = '2';
    dom.stepBadge.querySelector('.step-text').textContent = 'Now Scan Barcode';
    dom.btnActionText.textContent = 'Enter Barcode';
    if (dom.btnActionIconCamera) dom.btnActionIconCamera.hidden = true;
    if (dom.btnActionIconBarcode) dom.btnActionIconBarcode.hidden = false;
    dom.btnManualEntry.hidden = false;
    dom.scanOverlay.hidden = false;

    // Show floating captured photo thumbnail with retake option
    if (pendingPhotoBlob) {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
      previewBlobUrl = URL.createObjectURL(pendingPhotoBlob);
      dom.photoPreviewImg.src = previewBlobUrl;
      dom.photoPreview.hidden = false;
    }
  }
}

/* ═══════════════════════════════════════════
   Event Binding
   ═══════════════════════════════════════════ */
function bindEvents() {
  // Name prompt (form submit supports virtual keyboard 'Go/Done' key)
  if (dom.formUserName) {
    dom.formUserName.addEventListener('submit', (e) => {
      e.preventDefault();
      handleNameSubmit();
    });
  }
  dom.btnNameSubmit.addEventListener('click', handleNameSubmit);

  // Main action button (Step 1: Snap Photo, Step 2: opens manual entry)
  dom.btnAction.addEventListener('click', handleActionButton);

  // Flash
  dom.btnFlash.addEventListener('click', handleFlashToggle);

  // Manual barcode entry (only visible during Step 2)
  dom.btnManualEntry.addEventListener('click', openManualEntryModal);

  // Retake photo during Step 2
  if (dom.btnRetakeStep) {
    dom.btnRetakeStep.addEventListener('click', handleRetakeCurrentStep);
  }

  // Retry camera
  dom.btnRetryCamera.addEventListener('click', initCamera);

  // Camera switch
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

  // Zoom
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

  // Gallery clicks
  dom.gallery.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete');
    if (deleteBtn) {
      e.stopPropagation();
      deletePhoto(deleteBtn.dataset.id);
      return;
    }
    const photoCard = e.target.closest('.photo-item');
    if (photoCard) {
      const photo = photos.find(p => p.id === photoCard.dataset.id);
      if (photo) openLightbox(photo);
    }
  });

  // Gallery search
  dom.gallerySearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderGallery();
  });

  // Action Bar
  dom.btnZipShare.addEventListener('click', handleZipAndShare);
  dom.btnClear.addEventListener('click', () => { dom.confirmOverlay.hidden = false; });
  dom.btnConfirmClear.addEventListener('click', () => {
    clearAllPhotos();
    dom.confirmOverlay.hidden = true;
  });
  dom.btnConfirmCancel.addEventListener('click', () => { dom.confirmOverlay.hidden = true; });
  dom.confirmOverlay.addEventListener('click', (e) => {
    if (e.target === dom.confirmOverlay) dom.confirmOverlay.hidden = true;
  });

  // Lightbox
  dom.btnLightboxClose.addEventListener('click', closeLightbox);
  dom.lightbox.addEventListener('click', (e) => {
    if (e.target === dom.lightbox || e.target.classList.contains('lightbox-body')) closeLightbox();
  });
  dom.btnLightboxRotate.addEventListener('click', handleLightboxRotate);
  if (dom.btnLightboxRetake) {
    dom.btnLightboxRetake.addEventListener('click', handleLightboxRetake);
  }
  dom.btnLightboxDelete.addEventListener('click', handleLightboxDelete);

  // Settings
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
    closeModal();
    setStep(STEP.PHOTO);
  });
  dom.manualBarcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleModalSave();
  });
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) {
      closeModal();
    }
  });

  // Install
  dom.btnInstall.addEventListener('click', handleInstall);
  dom.btnDismissInstall.addEventListener('click', () => { dom.installBanner.hidden = true; });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeSettingsModal();
      closeModal();
      dom.confirmOverlay.hidden = true;
      if (currentStep === STEP.BARCODE && !pendingPhotoBlob) {
        setStep(STEP.PHOTO);
      }
    }
  });
}

/* ═══════════════════════════════════════════
   Core Workflow: 2-Step Photo → Barcode
   ═══════════════════════════════════════════ */
async function handleActionButton() {
  if (!scanner || !scanner.isReady()) {
    showToast('Camera not ready. Please allow camera access.', 'error');
    return;
  }

  if (currentStep === STEP.PHOTO) {
    // ──── STEP 1: Snap Product Photo ────
    dom.btnAction.disabled = true;

    triggerShutterFlash();
    playShutterSound();
    triggerHaptic(40);

    const { quality, maxDimension } = getActiveCompressionParams();
    const blob = await scanner.capturePhoto(quality, maxDimension);

    dom.btnAction.disabled = false;

    if (!blob) {
      showToast('Failed to capture photo', 'error');
      return;
    }

    // If retaking an already existing photo from lightbox:
    if (retakeTargetBarcode) {
      const targetPhoto = photos.find(p => p.barcode === retakeTargetBarcode);
      if (targetPhoto) {
        if (targetPhoto._blobUrl) URL.revokeObjectURL(targetPhoto._blobUrl);
        targetPhoto.blob = blob;
        targetPhoto.size = blob.size;
        targetPhoto._blobUrl = URL.createObjectURL(blob);
        targetPhoto.timestamp = Date.now();
        await persistPhoto(targetPhoto);
        renderGallery();
        updateStats();
        showToast(`✓ Photo updated for ${retakeTargetBarcode} (${formatSize(blob.size)})`, 'success');
      }
      retakeTargetBarcode = null;
      setStep(STEP.PHOTO);
      return;
    }

    pendingPhotoBlob = blob;
    showToast(`📸 Photo captured (${formatSize(blob.size)}) — now scan barcode`, 'success');

    // Transition to Step 2
    setStep(STEP.BARCODE);

    // Start automatic barcode scanning
    startBarcodeScanning();

  } else if (currentStep === STEP.BARCODE) {
    // In Step 2, tapping the button opens manual entry
    openManualEntryModal();
  }
}

function handleRetakeCurrentStep() {
  if (scanner) scanner.stopContinuousScan();
  pendingPhotoBlob = null;
  setStep(STEP.PHOTO);
  showToast('Photo discarded. Ready to take new photo.');
}

async function startBarcodeScanning() {
  if (!scanner || !scanner.hasNativeScanning()) {
    // No native scanning — skip to manual entry after brief pause
    dom.scanFrame.classList.add('scanning');
    dom.scanStatus.hidden = false;
    setTimeout(() => {
      dom.scanFrame.classList.remove('scanning');
      dom.scanStatus.hidden = true;
      dom.btnActionText.textContent = 'Enter Barcode';
      openManualEntryModal();
    }, 1500);
    return;
  }

  dom.scanFrame.classList.add('scanning');
  dom.scanStatus.hidden = false;

  const barcode = await scanner.scanUntilFound(
    null,
    CONFIG.SCAN_INTERVAL_MS,
    CONFIG.SCAN_TIMEOUT_MS
  );

  dom.scanFrame.classList.remove('scanning', 'success');
  dom.scanStatus.hidden = true;

  if (barcode && pendingPhotoBlob) {
    // Check for duplicate barcode — strictly block and alert
    const isDuplicate = photos.some(p => p.barcode === barcode.value);
    if (isDuplicate) {
      dom.scanFrame.classList.add('error');
      playErrorTone();
      triggerHaptic([120, 80, 120]);
      showToast(`❌ Barcode ${barcode.value} already scanned! Each barcode must be unique.`, 'error');

      // Keep photo intact, resume scanning for correct barcode after a moment
      setTimeout(() => {
        dom.scanFrame.classList.remove('error');
        if (currentStep === STEP.BARCODE && pendingPhotoBlob) {
          startBarcodeScanning();
        }
      }, 1600);
      return;
    }

    // Success: unique barcode detected!
    dom.scanFrame.classList.add('success');
    playBarcodeBeep();
    triggerHaptic([60, 40, 60]);

    await savePhoto(barcode.value, pendingPhotoBlob);
    pendingPhotoBlob = null;
    showToast(`✓ Saved: ${barcode.value} (${formatSize(photos[photos.length - 1].size)})`, 'success');

    // Return to Step 1 for next product
    setStep(STEP.PHOTO);
  } else if (pendingPhotoBlob) {
    // No barcode found — offer manual entry
    dom.btnActionText.textContent = 'Enter Barcode';
    openManualEntryModal();
  }
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
    setStep(STEP.PHOTO);
    return;
  }

  // Check for duplicate barcode — strictly block and alert
  const isDuplicate = photos.some(p => p.barcode === barcode);
  if (isDuplicate) {
    playErrorTone();
    triggerHaptic([120, 80, 120]);
    dom.manualBarcode.style.borderColor = 'var(--danger)';
    showToast(`❌ Barcode ${barcode} already exists! Each barcode must be unique.`, 'error');
    dom.manualBarcode.select();
    dom.manualBarcode.focus();
    return; // Do not close modal, do not save!
  }

  const blob = pendingPhotoBlob;
  pendingPhotoBlob = null;
  closeModal();

  await savePhoto(barcode, blob);
  showToast(`✓ Saved: ${barcode} (${formatSize(blob.size)})`, 'success');

  // Return to Step 1 for next product
  setStep(STEP.PHOTO);
}

/* ═══════════════════════════════════════════
   Photo Management
   ═══════════════════════════════════════════ */
async function savePhoto(barcode, blob) {
  const fileName = `${barcode}.jpg`;

  const photo = {
    id: generateId(),
    barcode,
    fileName,
    blob,
    timestamp: Date.now(),
    size: blob.size
  };

  photos.push(photo);
  await persistPhoto(photo);
  renderGallery();
  updateStats();
}

async function deletePhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (photo && photo._blobUrl) URL.revokeObjectURL(photo._blobUrl);
  photos = photos.filter(p => p.id !== id);
  await removePhoto(id);
  renderGallery();
  updateStats();
  showToast('Photo deleted');
}

async function clearAllPhotos() {
  photos.forEach(p => { if (p._blobUrl) URL.revokeObjectURL(p._blobUrl); });
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

  if (!hasPhotos) { dom.gallery.innerHTML = ''; return; }

  const displayed = searchQuery
    ? photos.filter(p => p.barcode.toLowerCase().includes(searchQuery) || p.fileName.toLowerCase().includes(searchQuery))
    : photos;

  if (displayed.length === 0) {
    dom.gallery.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted);">No photos matching "${escapeHtml(searchQuery)}"</div>`;
    return;
  }

  dom.gallery.innerHTML = displayed.map(photo => {
    if (!photo._blobUrl) photo._blobUrl = URL.createObjectURL(photo.blob);
    return `
      <div class="photo-item" data-id="${photo.id}" title="Tap to inspect">
        <img src="${photo._blobUrl}" alt="${escapeHtml(photo.barcode)}" loading="lazy">
        <div class="photo-label">
          <span class="photo-name">${escapeHtml(photo.fileName)}</span>
          <span class="photo-size">${formatSize(photo.size)}</span>
        </div>
        <button class="btn-delete" data-id="${photo.id}" aria-label="Delete ${escapeHtml(photo.fileName)}">×</button>
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
   Photo Lightbox
   ═══════════════════════════════════════════ */
function openLightbox(photo) {
  activeLightboxPhoto = photo;
  dom.lightboxTitle.textContent = photo.fileName;
  dom.lightboxSize.textContent = `${formatSize(photo.size)} • ${new Date(photo.timestamp).toLocaleTimeString()}`;
  dom.lightboxImg.src = photo._blobUrl;
  dom.lightbox.hidden = false;
}

function closeLightbox() {
  dom.lightbox.hidden = true;
  activeLightboxPhoto = null;
}

async function handleLightboxRotate() {
  if (!activeLightboxPhoto) return;
  dom.btnLightboxRotate.disabled = true;
  try {
    const rotatedBlob = await rotateBlob90(activeLightboxPhoto.blob);
    if (!rotatedBlob) throw new Error('Rotation failed');
    if (activeLightboxPhoto._blobUrl) URL.revokeObjectURL(activeLightboxPhoto._blobUrl);
    activeLightboxPhoto.blob = rotatedBlob;
    activeLightboxPhoto.size = rotatedBlob.size;
    activeLightboxPhoto._blobUrl = URL.createObjectURL(rotatedBlob);
    dom.lightboxImg.src = activeLightboxPhoto._blobUrl;
    dom.lightboxSize.textContent = `${formatSize(rotatedBlob.size)} • ${new Date(activeLightboxPhoto.timestamp).toLocaleTimeString()}`;
    await persistPhoto(activeLightboxPhoto);
    renderGallery();
    updateStats();
    showToast('Photo rotated!', 'success');
  } catch (err) {
    showToast('Failed to rotate photo', 'error');
  } finally {
    dom.btnLightboxRotate.disabled = false;
  }
}

function handleLightboxRetake() {
  if (!activeLightboxPhoto) return;
  retakeTargetBarcode = activeLightboxPhoto.barcode;
  closeLightbox();
  setStep(STEP.PHOTO);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast(`Retaking photo for ${retakeTargetBarcode}. Tap Snap Photo`);
}

function handleLightboxDelete() {
  if (!activeLightboxPhoto) return;
  const id = activeLightboxPhoto.id;
  closeLightbox();
  deletePhoto(id);
}

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
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/* ═══════════════════════════════════════════
   Settings Modal
   ═══════════════════════════════════════════ */
function openSettingsModal() {
  applySettingsToUI();
  dom.settingsOverlay.hidden = false;
}

function closeSettingsModal() {
  dom.settingsOverlay.hidden = true;
}

function applySettingsToUI() {
  dom.radioCompression.forEach(r => { r.checked = r.value === settings.compression; });
  dom.chkSound.checked = !!settings.sound;
  dom.chkShutterSound.checked = !!settings.shutterSound;
  dom.chkVibration.checked = !!settings.vibration;
}

function handleSaveSettings() {
  const selected = Array.from(dom.radioCompression).find(r => r.checked);
  if (selected) settings.compression = selected.value;
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
   Zip & Share with Progress Bar
   ZIP Name: {UserName}_{Date}_{DailySerial}.zip
   ═══════════════════════════════════════════ */
function getLocalDateStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDailySerial() {
  const today = getLocalDateStr();
  const key = 'kuberan_zip_serial';
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(key) || '{}');
  } catch (e) { /* ignore */ }

  if (data.date !== today) {
    data = { date: today, serial: 1 };
  } else {
    data.serial = (data.serial || 0) + 1;
  }

  localStorage.setItem(key, JSON.stringify(data));
  return String(data.serial).padStart(3, '0');
}

function buildZipFileName() {
  const name = userName || 'Scanner';
  const date = getLocalDateStr();
  const serial = getDailySerial();
  // Sanitize name: remove special chars
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeName}_${date}_${serial}.zip`;
}

async function handleZipAndShare() {
  if (photos.length === 0) return;

  // Reset progress bar
  dom.progressFill.style.width = '0%';
  dom.progressPercent.textContent = '0%';
  dom.loadingText.textContent = 'Preparing photos…';
  dom.loadingOverlay.hidden = false;

  try {
    const zip = new JSZip();

    for (let i = 0; i < photos.length; i++) {
      zip.file(photos[i].fileName, photos[i].blob, { binary: true });
      const addPct = Math.round(((i + 1) / photos.length) * 30);
      dom.progressFill.style.width = `${addPct}%`;
      dom.progressPercent.textContent = `${addPct}%`;
      dom.loadingText.textContent = `Adding photo ${i + 1} of ${photos.length}…`;
    }

    dom.loadingText.textContent = 'Compressing…';
    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (metadata) => {
        const pct = 30 + Math.round(metadata.percent * 0.7);
        dom.progressFill.style.width = `${pct}%`;
        dom.progressPercent.textContent = `${pct}%`;
        dom.loadingText.textContent = `Compressing… ${Math.round(metadata.percent)}%`;
      }
    );

    dom.progressFill.style.width = '100%';
    dom.progressPercent.textContent = '100%';
    dom.loadingText.textContent = 'Ready to share!';

    const zipFileName = buildZipFileName();
    const zipFile = new File([zipBlob], zipFileName, { type: 'application/zip' });

    // Brief pause to show 100%
    await new Promise(r => setTimeout(r, 400));
    dom.loadingOverlay.hidden = true;

    // Try Web Share API
    if (navigator.canShare && navigator.canShare({ files: [zipFile] })) {
      try {
        await navigator.share({
          title: 'Kuberan Scanner Photos',
          text: `${photos.length} photos (${formatSize(zipBlob.size)})`,
          files: [zipFile]
        });
        showToast(`✓ Shared: ${zipFileName}`, 'success');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[App] Share failed, falling back to download:', err);
        }
      }
    }

    // Fallback: Download
    downloadBlob(zipBlob, zipFileName);
    showToast(`Downloaded: ${zipFileName}`, 'success');

  } catch (err) {
    console.error('[App] Zip creation failed:', err);
    showToast('Failed to create zip', 'error');
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
    request.onerror = () => resolve(null);
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
    store.put({ id: photo.id, barcode: photo.barcode, fileName: photo.fileName, blob: photo.blob, timestamp: photo.timestamp, size: photo.size });
    tx.oncomplete = resolve;
    tx.onerror = () => resolve();
  });
}

function removePhoto(id) {
  if (!db) return Promise.resolve();
  return new Promise((resolve) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    tx.objectStore(CONFIG.STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => resolve();
  });
}

function clearAllPersistedPhotos() {
  if (!db) return Promise.resolve();
  return new Promise((resolve) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    tx.objectStore(CONFIG.STORE_NAME).clear();
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
    setTimeout(() => { dom.installBanner.hidden = false; }, 2000);
  });
  window.addEventListener('appinstalled', () => {
    dom.installBanner.hidden = true;
    deferredInstallPrompt = null;
    showToast('App installed!', 'success');
  });
}

async function handleInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') dom.installBanner.hidden = true;
  deferredInstallPrompt = null;
}

/* ═══════════════════════════════════════════
   Toast
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
