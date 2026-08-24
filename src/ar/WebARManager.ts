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

      // --- Tracking Quality Tuning for Moving Targets ---
      // Higher filterMinCF = less smoothing lag during slow movements
      filterMinCF: 0.001,

      // High filterBeta = locks instantly to fast movement with zero lag
      // (This prevents the 3D model from sliding off when the target moves)
      filterBeta: 10.0,

      // missTolerance: wait only 3 frames before declaring target lost.
      // This stops the model from "ghosting" or floating in empty space
      // when the target moves quickly out of frame.
      missTolerance: 3,

      // warmupTolerance: frames target must be visible before displaying model.
      // Lower means the model pops up instantly.
      warmupTolerance: 2,

      // Process candidate feature points per frame
      maxTrack: 1,
      processingMaxCount: 500,

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

    try {
      const video = this.mindarThree.video as HTMLVideoElement;
      if (video && video.srcObject) {
        const stream = video.srcObject as MediaStream;
        this.videoTrack = stream.getVideoTracks()[0] ?? null;

        if (this.videoTrack) {
          // Get what the camera actually supports first
          const caps = this.videoTrack.getCapabilities() as any;

          const constraints: MediaTrackConstraints & Record<string, any> = {
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
            // Continuous modes greatly help in auto-adjusting for low light & skin
            whiteBalanceMode: 'continuous',
            exposureMode:     'continuous',
            focusMode:        'continuous',
          };

          // Digital zoom: make small targets fill more of the frame
          // MindAR processes the full video frame — more pixels of the target = better tracking
          // Clamp to device max so we don't crash on unsupported zoom levels
          if (caps.zoom) {
            const idealZoom = 2.0;
            const safeZoom = Math.min(idealZoom, caps.zoom.max ?? idealZoom);
            constraints.zoom = safeZoom;
            console.log(`[WebAR] Applying camera zoom: ${safeZoom}x (max: ${caps.zoom.max})`);
          }

          await this.videoTrack.applyConstraints(constraints);
        }
      }
    } catch (err) {
      console.warn('[WebAR] Could not apply advanced camera constraints:', err);
    }
  }

  /** Set camera digital zoom level. Returns actual zoom applied. */
  public async setCameraZoom(level: number): Promise<number> {
    if (!this.videoTrack) return 1;
    try {
      const caps = this.videoTrack.getCapabilities() as any;
      if (!caps.zoom) return 1;
      const safeZoom = Math.min(Math.max(level, caps.zoom.min ?? 1), caps.zoom.max ?? level);
      // @ts-ignore
      await this.videoTrack.applyConstraints({ zoom: safeZoom });
      return safeZoom;
    } catch {
      return 1;
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
