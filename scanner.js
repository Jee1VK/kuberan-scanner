/**
 * BarcodeScanner — Camera access and barcode detection module
 * Uses native BarcodeDetector API (Chrome Android) with manual-entry fallback.
 * Supports hardware/software zoom and camera switching.
 */
class BarcodeScanner {
  /**
   * @param {HTMLVideoElement} videoElement
   * @param {HTMLCanvasElement} canvasElement
   */
  constructor(videoElement, canvasElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
    this.detector = null;
    this.stream = null;
    this._ready = false;
    this._scanInterval = null;

    // Zoom & Camera states
    this.zoomLevel = 1.0;
    this.hasHardwareZoom = false;
    this.zoomMin = 1.0;
    this.zoomMax = 3.0;
    this.availableCameras = [];
    this.currentCameraIndex = 0;
    this.activeVideo = videoElement;

    /** Supported barcode formats */
    this.formats = [
      'ean_13', 'ean_8',
      'upc_a', 'upc_e',
      'code_128', 'code_39',
      'qr_code', 'codabar',
      'itf'
    ];
  }

  /* ──────────── Static helpers ──────────── */

  static isNativeSupported() {
    return 'BarcodeDetector' in window;
  }

  static async isCameraAvailable() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return false;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'videoinput');
    } catch {
      return false;
    }
  }

  /* ──────────── Lifecycle ──────────── */

  /**
   * Initialize camera stream and barcode detector.
   * Uses progressive fallback to guarantee maximum compatibility across devices.
   * @param {string|null} preferredDeviceId
   * @returns {Promise<boolean>}
   */
  async init(preferredDeviceId = null) {
    try {
      // 1. Check for browser MediaDevices support and secure context
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!window.isSecureContext) {
          throw new Error('Camera access requires a secure HTTPS connection. Please ensure you open the app via HTTPS (e.g. https://jee1vk.github.io/kuberan-scanner/).');
        }
        throw new Error('Camera API (getUserMedia) is not supported by this browser. Please use Google Chrome, Safari, or Microsoft Edge.');
      }

      // Stop any existing stream on this scanner instance before starting fresh
      if (this.stream) {
        this.stop();
      }

      this.hasHardwareZoom = false;
      this.zoomMin = 1.0;
      this.zoomMax = 3.0;

      // Discover available camera devices safely
      try {
        if (navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          this.availableCameras = devices.filter(d => d.kind === 'videoinput');
        }
      } catch (err) {
        console.warn('[Scanner] Device enumeration warning:', err);
      }

      // Progressive constraint fallback list
      const attempts = [];

      if (preferredDeviceId) {
        attempts.push({
          video: {
            deviceId: { ideal: preferredDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
        attempts.push({
          video: {
            deviceId: { ideal: preferredDeviceId }
          },
          audio: false
        });
      }

      // 1. Rear/environment camera with 1080p ideal resolution
      attempts.push({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      // 2. Rear/environment camera with 720p ideal resolution
      attempts.push({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      // 3. Rear/environment camera without resolution constraints
      attempts.push({
        video: {
          facingMode: { ideal: 'environment' }
        },
        audio: false
      });

      // 4. Exact rear camera string (for iOS Safari/WebKit edge cases)
      attempts.push({
        video: {
          facingMode: 'environment'
        },
        audio: false
      });

      // 5. Generic video (any available camera: front, external USB, laptop webcam)
      attempts.push({
        video: true,
        audio: false
      });

      let acquiredStream = null;
      let lastError = null;

      for (const constraints of attempts) {
        try {
          acquiredStream = await navigator.mediaDevices.getUserMedia(constraints);
          if (acquiredStream) {
            this.stream = acquiredStream;
            console.log('[Scanner] Camera acquired with constraints:', constraints);
            break;
          }
        } catch (err) {
          console.warn('[Scanner] Constraints failed, trying next fallback:', err.name, err.message);
          lastError = err;
          // If the user actively blocked camera permission, don't keep cycling through constraints
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            throw err;
          }
        }
      }

      if (!this.stream) {
        throw lastError || new Error('Unable to start video stream.');
      }

      // Prepare video element with all iOS and Android required attributes
      this.video.muted = true;
      this.video.defaultMuted = true;
      this.video.playsInline = true;
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.setAttribute('autoplay', '');

      this.video.srcObject = this.stream;

      // Update current camera index
      const activeTrack = this.stream.getVideoTracks()[0];
      if (activeTrack && this.availableCameras.length > 0) {
        const settings = activeTrack.getSettings ? activeTrack.getSettings() : {};
        if (settings.deviceId) {
          const foundIdx = this.availableCameras.findIndex(d => d.deviceId === settings.deviceId);
          if (foundIdx !== -1) this.currentCameraIndex = foundIdx;
        }
      }

      // Check hardware zoom capabilities
      if (activeTrack && typeof activeTrack.getCapabilities === 'function') {
        try {
          const caps = activeTrack.getCapabilities();
          if (caps.zoom) {
            this.hasHardwareZoom = true;
            this.zoomMin = caps.zoom.min || 1.0;
            this.zoomMax = Math.min(caps.zoom.max || 3.0, 5.0);
          }
        } catch (e) {
          console.warn('[Scanner] Zoom capabilities check error:', e);
        }
      }

      // Wait for video stream to play and render
      await new Promise((resolve, reject) => {
        let isDone = false;

        const cleanup = () => {
          clearTimeout(timeoutId);
          this.video.removeEventListener('loadedmetadata', onReady);
          this.video.removeEventListener('loadeddata', onReady);
          this.video.removeEventListener('canplay', onReady);
          this.video.removeEventListener('playing', onReady);
        };

        const onReady = () => {
          if (isDone) return;
          isDone = true;
          cleanup();
          this.video.play()
            .then(resolve)
            .catch(playErr => {
              console.warn('[Scanner] Play rejected, retrying in 100ms:', playErr);
              setTimeout(() => {
                this.video.play().then(resolve).catch(reject);
              }, 100);
            });
        };

        // 8 second safety timeout
        const timeoutId = setTimeout(() => {
          if (isDone) return;
          if (this.video.videoWidth > 0 || this.video.readyState >= 1) {
            console.warn('[Scanner] Video readyState partial, proceeding despite timeout');
            isDone = true;
            cleanup();
            this.video.play().then(resolve).catch(() => resolve());
          } else {
            isDone = true;
            cleanup();
            reject(new Error('Camera connection timed out. Please check camera permissions and tap Try Again.'));
          }
        }, 8000);

        if (this.video.readyState >= 2) {
          onReady();
        } else {
          this.video.addEventListener('loadedmetadata', onReady, { once: true });
          this.video.addEventListener('loadeddata', onReady, { once: true });
          this.video.addEventListener('canplay', onReady, { once: true });
          this.video.addEventListener('playing', onReady, { once: true });
          // Explicitly call play to trigger pipeline on mobile
          this.video.play().then(onReady).catch(() => {});
        }
      });

      // Apply initial zoom
      await this.setZoom(this.zoomLevel);

    } catch (err) {
      console.error('[Scanner] Camera access failed:', err);
      let userFriendlyMsg;

      if (!window.isSecureContext) {
        userFriendlyMsg = 'Camera access requires HTTPS. Please open the app at https://jee1vk.github.io/kuberan-scanner/';
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userFriendlyMsg = 'Camera permission was denied. Please allow camera access in browser site settings and tap Try Again.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        userFriendlyMsg = 'No camera found or recognized on this device. Please ensure a camera is attached and enabled.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        userFriendlyMsg = 'Camera is in use by another app or tab. Please close other camera apps and tap Try Again.';
      } else if (err.name === 'OverconstrainedError') {
        userFriendlyMsg = 'Camera constraints could not be satisfied. Please tap Try Again.';
      } else {
        userFriendlyMsg = err.message || 'Camera could not be recognized. Please check permissions and tap Try Again.';
      }

      throw new Error(userFriendlyMsg);
    }

    // Initialize native barcode detector if available
    if (BarcodeScanner.isNativeSupported() && !this.detector) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        const usableFormats = this.formats.filter(f => supported.includes(f));
        if (usableFormats.length > 0) {
          this.detector = new BarcodeDetector({ formats: usableFormats });
          console.log('[Scanner] Native BarcodeDetector ready. Formats:', usableFormats);
        }
      } catch (err) {
        console.warn('[Scanner] BarcodeDetector init failed:', err);
      }
    }

    this._ready = true;
    return true;
  }

  /**
   * Stop camera and release all resources.
   */
  stop() {
    this.stopContinuousScan();
    if (this.stream) {
      try {
        this.stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {}
        });
      } catch (e) {
        console.warn('[Scanner] Error stopping tracks:', e);
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    if (this.activeVideo && this.activeVideo !== this.video) {
      this.activeVideo.srcObject = null;
    }
    this._ready = false;
  }

  /**
   * Switch to next available camera (e.g. ultra-wide or back/front).
   * @returns {Promise<boolean>}
   */
  async switchCamera() {
    if (this.availableCameras.length <= 1) return false;
    this.currentCameraIndex = (this.currentCameraIndex + 1) % this.availableCameras.length;
    const nextDevice = this.availableCameras[this.currentCameraIndex];
    this.stop();
    await this.init(nextDevice.deviceId);
    if (this.activeVideo && this.activeVideo !== this.video && this.stream) {
      this.activeVideo.srcObject = this.stream;
      this.activeVideo.play().catch(() => {});
    }
    return true;
  }

  /**
   * Set active video element for scanning and zoom (e.g. barcode-only mode feed).
   * @param {HTMLVideoElement} videoElement
   */
  setActiveVideo(videoElement) {
    if (videoElement) {
      this.activeVideo = videoElement;
    }
  }

  /* ──────────── Zoom Control ──────────── */

  /**
   * Set digital or hardware zoom factor (e.g. 1.0, 2.0).
   * @param {number} level
   * @returns {Promise<number>} applied zoom level
   */
  async setZoom(level) {
    this.zoomLevel = Math.max(1.0, Math.min(level, this.zoomMax));

    if (this.stream) {
      const track = this.stream.getVideoTracks()[0];
      if (this.hasHardwareZoom && track) {
        try {
          await track.applyConstraints({
            advanced: [{ zoom: this.zoomLevel }]
          });
          // Reset any CSS scale if hardware zoom succeeded
          this.video.style.transform = '';
          if (this.activeVideo) this.activeVideo.style.transform = '';
          return this.zoomLevel;
        } catch (e) {
          console.debug('[Scanner] Hardware zoom constraint failed, falling back to CSS zoom', e);
        }
      }
    }

    // Fallback: Software/CSS zoom on video element
    const vid = this.activeVideo || this.video;
    if (this.zoomLevel > 1.0) {
      vid.style.transform = `scale(${this.zoomLevel})`;
      vid.style.transformOrigin = 'center center';
    } else {
      vid.style.transform = '';
    }

    return this.zoomLevel;
  }

  /* ──────────── Scanning ──────────── */

  /**
   * Scan current video frame for barcodes.
   * Directly uses video element to avoid canvas contention with photo capture.
   * @param {HTMLVideoElement|null} overrideVideo
   * @returns {Promise<{value: string, format: string}|null>}
   */
  async scanFrame(overrideVideo = null) {
    const vid = overrideVideo || this.activeVideo || this.video;
    if (!this._ready || !vid || !vid.videoWidth) return null;
    if (!this.detector) return null;

    try {
      // First attempt direct video detection (fastest, zero canvas overhead)
      const barcodes = await this.detector.detect(vid);
      if (barcodes && barcodes.length > 0) {
        return {
          value: barcodes[0].rawValue,
          format: barcodes[0].format
        };
      }
    } catch (err) {
      // Fallback: draw frame to canvas and detect
      try {
        this.canvas.width = vid.videoWidth;
        this.canvas.height = vid.videoHeight;
        this.ctx.drawImage(vid, 0, 0);
        const barcodes = await this.detector.detect(this.canvas);
        if (barcodes && barcodes.length > 0) {
          return {
            value: barcodes[0].rawValue,
            format: barcodes[0].format
          };
        }
      } catch (innerErr) {
        console.debug('[Scanner] Frame scan error:', innerErr.message);
      }
    }

    return null;
  }

  /**
   * Start scanning continuously until a barcode is found.
   * @param {function} onDetected
   * @param {number} intervalMs
   * @param {number} timeoutMs
   * @returns {Promise<{value: string, format: string}|null>}
   */
  scanUntilFound(onDetected, intervalMs = 150, timeoutMs = 5000) {
    return new Promise((resolve) => {
      let elapsed = 0;

      const interval = setInterval(async () => {
        const result = await this.scanFrame();
        if (result) {
          clearInterval(interval);
          if (onDetected) onDetected(result);
          resolve(result);
        } else {
          elapsed += intervalMs;
          if (timeoutMs > 0 && elapsed >= timeoutMs) {
            clearInterval(interval);
            resolve(null);
          }
        }
      }, intervalMs);

      this._scanInterval = interval;
    });
  }

  stopContinuousScan() {
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
  }

  /* ──────────── Photo Capture ──────────── */

  /**
   * Capture current video frame with downscaling & software zoom crop support.
   * @param {number} quality — JPEG quality (0.0 to 1.0)
   * @param {number} maxDimension — Maximum width or height in px
   * @returns {Promise<Blob|null>}
   */
  capturePhoto(quality = 0.75, maxDimension = 1200) {
    if (!this._ready || !this.video.videoWidth) return Promise.resolve(null);

    const fullW = this.video.videoWidth;
    const fullH = this.video.videoHeight;

    let sx = 0;
    let sy = 0;
    let sWidth = fullW;
    let sHeight = fullH;

    // If software zoom was used (hardware zoom not applied directly to stream sensor)
    if (!this.hasHardwareZoom && this.zoomLevel > 1.0) {
      sWidth = fullW / this.zoomLevel;
      sHeight = fullH / this.zoomLevel;
      sx = (fullW - sWidth) / 2;
      sy = (fullH - sHeight) / 2;
    }

    let targetW = sWidth;
    let targetH = sHeight;

    // Scale down if image exceeds max dimension to keep size in KB
    if (maxDimension > 0 && (sWidth > maxDimension || sHeight > maxDimension)) {
      if (sWidth >= sHeight) {
        targetW = maxDimension;
        targetH = Math.round((sHeight * maxDimension) / sWidth);
      } else {
        targetH = maxDimension;
        targetW = Math.round((sWidth * maxDimension) / sHeight);
      }
    }

    this.canvas.width = targetW;
    this.canvas.height = targetH;
    this.ctx.drawImage(this.video, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);

    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, 'image/jpeg', quality);
    });
  }

  /* ──────────── Torch / Flash ──────────── */

  async toggleTorch() {
    if (!this.stream) return false;

    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;

    try {
      const capabilities = track.getCapabilities();
      if (!capabilities.torch) return false;

      const settings = track.getSettings();
      const newState = !settings.torch;

      await track.applyConstraints({
        advanced: [{ torch: newState }]
      });
      return newState;
    } catch (err) {
      console.warn('[Scanner] Torch toggle failed:', err);
      return false;
    }
  }

  /* ──────────── State queries ──────────── */

  isReady() {
    const vid = this.activeVideo || this.video;
    return this._ready && vid && vid.readyState >= 2;
  }

  hasNativeScanning() {
    return this.detector !== null;
  }

  getVideoDimensions() {
    const vid = this.activeVideo || this.video;
    return {
      width: vid ? (vid.videoWidth || 0) : 0,
      height: vid ? (vid.videoHeight || 0) : 0
    };
  }
}
