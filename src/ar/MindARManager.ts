// @ts-ignore
import { MindARThree } from 'mind-ar-three';
import * as THREE from 'three';

import { IARTracker, TargetPose } from './IARManager';

export class TargetTracker implements IARTracker {
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

import { IARManager } from './IARManager';

export class MindARManager implements IARManager {
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

      maxTrack: 1,

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
          // getCapabilities() is not available on all browsers (e.g. iOS Safari < 16)
          const caps: any = this.videoTrack.getCapabilities?.() ?? {};

          // 720p keeps MindAR's per-frame CPU/WASM tracker (which runs at
          // the raw video resolution — see mindar-image-three.prod.js) fast
          // enough to keep up with the aggressive low-lag filter settings
          // above. 1080p roughly doubles that per-frame cost for no
          // tracking-accuracy benefit.
          const constraints: MediaTrackConstraints & Record<string, any> = {
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          };

          // Continuous auto-modes (Android Chrome only — silently ignored elsewhere)
          try {
            Object.assign(constraints, {
              whiteBalanceMode: 'continuous',
              exposureMode:     'continuous',
              focusMode:        'continuous',
            });
          } catch { /* unsupported — skip */ }

          // Digital zoom: clamp to device max
          if (caps.zoom?.max) {
            const idealZoom = 2.0;
            const safeZoom = Math.min(idealZoom, caps.zoom.max);
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
      const caps: any = this.videoTrack.getCapabilities?.() ?? {};
      if (!caps.zoom) return 1;
      const minZoom = caps.zoom.min ?? 1;
      const maxZoom = caps.zoom.max ?? level;
      const safeZoom = Math.min(Math.max(level, minZoom), maxZoom);
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
