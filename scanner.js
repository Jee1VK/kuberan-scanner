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
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(d => d.kind === 'videoinput');
    } catch {
      return false;
    }
  }

  /* ──────────── Lifecycle ──────────── */

  /**
   * Initialize camera stream and barcode detector.
   * @param {string|null} preferredDeviceId
   * @returns {Promise<boolean>}
   */
  async init(preferredDeviceId = null) {
    try {
      // Discover available cameras
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.availableCameras = devices.filter(d => d.kind === 'videoinput');
      } catch (err) {
        console.warn('[Scanner] Failed to enumerate devices:', err);
      }

      // Build video constraints
      const videoConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      };

      if (preferredDeviceId) {
        videoConstraints.deviceId = { exact: preferredDeviceId };
      } else {
        videoConstraints.facingMode = { ideal: 'environment' };
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false
      });

      this.video.srcObject = this.stream;

      // Update current camera index
      const activeTrack = this.stream.getVideoTracks()[0];
      if (activeTrack && this.availableCameras.length > 0) {
        const settings = activeTrack.getSettings();
        const foundIdx = this.availableCameras.findIndex(d => d.deviceId === settings.deviceId);
        if (foundIdx !== -1) this.currentCameraIndex = foundIdx;
      }

      // Check zoom capabilities
      if (activeTrack && typeof activeTrack.getCapabilities === 'function') {
        const caps = activeTrack.getCapabilities();
        if (caps.zoom) {
          this.hasHardwareZoom = true;
          this.zoomMin = caps.zoom.min || 1.0;
          this.zoomMax = Math.min(caps.zoom.max || 3.0, 5.0);
        }
      }

      // Wait for video to play
      await new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(resolve).catch(reject);
        };
        setTimeout(() => reject(new Error('Camera timed out')), 10000);
      });

      // Apply initial zoom
      await this.setZoom(this.zoomLevel);

    } catch (err) {
      console.error('[Scanner] Camera access failed:', err);
      throw new Error(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in browser settings.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${err.message}`
      );
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
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
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
    return true;
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
          return this.zoomLevel;
        } catch (e) {
          console.debug('[Scanner] Hardware zoom constraint failed, falling back to CSS zoom', e);
        }
      }
    }

    // Fallback: Software/CSS zoom on video element
    if (this.zoomLevel > 1.0) {
      this.video.style.transform = `scale(${this.zoomLevel})`;
      this.video.style.transformOrigin = 'center center';
    } else {
      this.video.style.transform = '';
    }

    return this.zoomLevel;
  }

  /* ──────────── Scanning ──────────── */

  /**
   * Scan current video frame for barcodes.
   * Directly uses video element to avoid canvas contention with photo capture.
   * @returns {Promise<{value: string, format: string}|null>}
   */
  async scanFrame() {
    if (!this._ready || !this.video.videoWidth) return null;
    if (!this.detector) return null;

    try {
      // First attempt direct video detection (fastest, zero canvas overhead)
      const barcodes = await this.detector.detect(this.video);
      if (barcodes.length > 0) {
        return {
          value: barcodes[0].rawValue,
          format: barcodes[0].format
        };
      }
    } catch (err) {
      // Fallback: draw frame to canvas and detect
      try {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.drawImage(this.video, 0, 0);
        const barcodes = await this.detector.detect(this.canvas);
        if (barcodes.length > 0) {
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
    return this._ready && this.video.readyState >= 2;
  }

  hasNativeScanning() {
    return this.detector !== null;
  }

  getVideoDimensions() {
    return {
      width: this.video.videoWidth || 0,
      height: this.video.videoHeight || 0
    };
  }
}
