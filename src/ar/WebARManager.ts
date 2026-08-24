// @ts-ignore
import { MindARThree } from 'mind-ar-three';
import * as THREE from 'three';

export interface TargetPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}

export class TargetTracker {
  private anchorGroup: THREE.Group;
  public visible = false;
  private pose: TargetPose;

  constructor(mindarThree: any, targetIndex: number = 0) {
    const anchor = mindarThree.addAnchor(targetIndex);
    this.anchorGroup = anchor.group;

    this.pose = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      visible: false
    };

    anchor.onTargetFound = () => {
      this.visible = true;
      document.dispatchEvent(new CustomEvent('ar-target-found'));
    };
    anchor.onTargetLost = () => {
      this.visible = false;
      document.dispatchEvent(new CustomEvent('ar-target-lost'));
    };
  }

  public getPose(): TargetPose {
    const g = this.anchorGroup;
    this.pose.visible = g.visible;
    g.matrixWorld.decompose(this.pose.position, this.pose.quaternion, this.pose.scale);
    return this.pose;
  }
}

export class WebARManager {
  public mindarThree: any;
  private videoTrack: MediaStreamTrack | null = null;
  private torchOn = false;

  constructor(container: HTMLElement, targetUrl: string) {
    this.mindarThree = new MindARThree({
      container,
      imageTargetSrc: targetUrl,

      // --- Tracking Quality Tuning ---
      // Lower filterMinCF = more willing to accept weaker feature matches
      // Good for low-contrast targets like skin textures
      filterMinCF: 0.00001,

      // Higher filterBeta = less smoothing = faster response to movement
      // Good for when tracking is jumpy on skin that deforms/moves
      filterBeta: 0.01,

      // missTolerance: frames target must be missing before considered "lost"
      // Higher = more forgiving when lighting flickers, fewer false "lost" events
      missTolerance: 10,

      // warmupTolerance: frames target must be visible before considered "found"
      // Lower = snappier detection on first scan
      warmupTolerance: 3,

      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no'
    });
  }

  public getRenderer() { return this.mindarThree.renderer; }
  public getScene()    { return this.mindarThree.scene; }
  public getCamera()   { return this.mindarThree.camera; }

  public createTracker(index = 0) {
    return new TargetTracker(this.mindarThree, index);
  }

  public async start() {
    await this.mindarThree.start();

    // After MindAR starts, grab the actual video track so we can
    // request a higher-quality/brighter feed and control the torch
    try {
      const video = this.mindarThree.video as HTMLVideoElement;
      if (video && video.srcObject) {
        const stream = video.srcObject as MediaStream;
        this.videoTrack = stream.getVideoTracks()[0] ?? null;

        if (this.videoTrack) {
          // Request ideal constraints: high resolution + auto white balance
          // This significantly helps in low-light / skin texture scenarios
          await this.videoTrack.applyConstraints({
            width:        { ideal: 1920 },
            height:       { ideal: 1080 },
            // @ts-ignore – experimental but supported on Android Chrome
            whiteBalanceMode: 'continuous',
            // @ts-ignore
            exposureMode:     'continuous',
            // @ts-ignore
            focusMode:        'continuous'
          });
        }
      }
    } catch (err) {
      console.warn('[WebAR] Could not apply advanced camera constraints:', err);
    }
  }

  /** Toggle phone flashlight/torch. Returns new state. */
  public async toggleTorch(): Promise<boolean> {
    if (!this.videoTrack) return false;
    try {
      this.torchOn = !this.torchOn;
      // @ts-ignore – torch is supported on Android Chrome
      await this.videoTrack.applyConstraints({ advanced: [{ torch: this.torchOn }] });
      return this.torchOn;
    } catch {
      console.warn('[WebAR] Torch not supported on this device');
      return false;
    }
  }

  public isTorchOn() { return this.torchOn; }

  public stop() { this.mindarThree.stop(); }
}
