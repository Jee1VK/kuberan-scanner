/**
 * BarcodeScanner — Camera access and barcode detection module
 * Uses native BarcodeDetector API (Chrome Android) with manual-entry fallback
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

  /** Check if the native BarcodeDetector API is available */
  static isNativeSupported() {
    return 'BarcodeDetector' in window;
  }

  /** Check if camera access is possible */
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
   * Initialize the camera and barcode detector.
   * @returns {Promise<boolean>} true if camera started successfully
   */
  async init() {
    // Request camera
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // Prefer higher frame rate for smooth preview
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      this.video.srcObject = this.stream;

      // Wait for video to be ready
      await new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(resolve).catch(reject);
        };
        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Camera timed out')), 10000);
      });
    } catch (err) {
      console.error('[Scanner] Camera access failed:', err);
      throw new Error(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in your browser settings.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${err.message}`
      );
    }

    // Initialize native barcode detector if available
    if (BarcodeScanner.isNativeSupported()) {
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

    if (!this.detector) {
      console.log('[Scanner] Native scanning unavailable — manual entry will be used');
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

  /* ──────────── Scanning ──────────── */

  /**
   * Scan the current video frame for barcodes.
   * @returns {Promise<{value: string, format: string}|null>}
   */
  async scanFrame() {
    if (!this._ready || !this.video.videoWidth) return null;
    if (!this.detector) return null;

    // Draw current frame to canvas
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.ctx.drawImage(this.video, 0, 0);

    try {
      const barcodes = await this.detector.detect(this.canvas);
      if (barcodes.length > 0) {
        return {
          value: barcodes[0].rawValue,
          format: barcodes[0].format
        };
      }
    } catch (err) {
      // Detection errors are expected for unclear frames
      console.debug('[Scanner] Frame scan error:', err.message);
    }

    return null;
  }

  /**
   * Start scanning continuously until a barcode is found.
   * @param {function} onDetected — called with {value, format} when barcode found
   * @param {number} intervalMs — scan interval in milliseconds
   * @param {number} timeoutMs — give up after this many ms (0 = no timeout)
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
            resolve(null); // Timed out — no barcode found
          }
        }
      }, intervalMs);

      this._scanInterval = interval;
    });
  }

  /**
   * Start continuous background scanning (for live preview feedback).
   * @param {function} onDetected — called each time a barcode is detected
   * @param {number} intervalMs
   */
  startContinuousScan(onDetected, intervalMs = 250) {
    this.stopContinuousScan();
    this._scanInterval = setInterval(async () => {
      const result = await this.scanFrame();
      if (result && onDetected) {
        onDetected(result);
      }
    }, intervalMs);
  }

  /** Stop continuous scanning */
  stopContinuousScan() {
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
  }

  /* ──────────── Photo Capture ──────────── */

  /**
   * Capture the current video frame as a JPEG Blob.
   * @param {number} quality — JPEG quality 0-1
   * @returns {Promise<Blob|null>}
   */
  capturePhoto(quality = 0.92) {
    if (!this._ready || !this.video.videoWidth) return Promise.resolve(null);

    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.ctx.drawImage(this.video, 0, 0);

    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, 'image/jpeg', quality);
    });
  }

  /* ──────────── Torch / Flash ──────────── */

  /**
   * Toggle the device torch (flashlight).
   * @returns {Promise<boolean>} new torch state, or false if unsupported
   */
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

  /** @returns {boolean} true if camera is active and video is playing */
  isReady() {
    return this._ready && this.video.readyState >= 2;
  }

  /** @returns {boolean} true if native barcode detection is available */
  hasNativeScanning() {
    return this.detector !== null;
  }

  /** @returns {{width: number, height: number}} current video dimensions */
  getVideoDimensions() {
    return {
      width: this.video.videoWidth || 0,
      height: this.video.videoHeight || 0
    };
  }
}
