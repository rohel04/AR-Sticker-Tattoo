import { IARManager, IARTracker, TargetPose } from './IARManager';
import * as THREE from 'three';

declare global {
  interface Window { XR8: any; XRExtras: any; }
}

// ── XR8Tracker ────────────────────────────────────────────────────────────────
class XR8Tracker implements IARTracker {
  public visible = false;
  private pose: TargetPose;
  private targetName: string;

  constructor(targetName: string) {
    this.targetName = targetName;
    this.pose = {
      position:   new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale:      new THREE.Vector3(1, 1, 1),
      visible:    false,
    };

    window.addEventListener('reality.imagefound', ((e: CustomEvent) => {
      if (e.detail.name !== this.targetName) return;
      this.visible = true;
      this.pose.visible = true;
      this._updatePose(e.detail);
      document.dispatchEvent(new CustomEvent('ar-target-found'));
    }) as EventListener);

    window.addEventListener('reality.imageupdated', ((e: CustomEvent) => {
      if (e.detail.name !== this.targetName) return;
      this._updatePose(e.detail);
    }) as EventListener);

    window.addEventListener('reality.imagelost', ((e: CustomEvent) => {
      if (e.detail.name !== this.targetName) return;
      this.visible = false;
      this.pose.visible = false;
      document.dispatchEvent(new CustomEvent('ar-target-lost'));
    }) as EventListener);
  }

  private _updatePose(detail: any) {
    const { position, rotation, scale } = detail;
    this.pose.position.set(position.x, position.y, position.z);
    this.pose.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    
    const s = (typeof scale === 'number') ? scale : 1;
    this.pose.scale.set(s, s, s);
  }

  public getPose(): TargetPose { return this.pose; }
}

// ── XREngineManager ────────────────────────────────────────────────────────────
// Single-canvas architecture using XR8.Threejs.pipelineModule():
//   - XR8 owns the single canvas & handles the camera feed as a background
//   - XR8.Threejs creates & manages the Three.js scene/camera/renderer
//   - We grab those objects via XR8.Threejs.xrScene() once the pipeline starts
//   - Our ThreeScene then populates that scene with models
export class XREngineManager implements IARManager {
  private targetUrl: string;
  private canvas: HTMLCanvasElement;

  // These are set lazily after XR8.Threejs.xrScene() is available
  private _scene!: THREE.Scene;
  private _camera!: THREE.PerspectiveCamera;
  private _renderer!: THREE.WebGLRenderer;

  private torchOn = false;
  private videoTrack: MediaStreamTrack | null = null;
  public _onRenderCallback: (() => void) | null = null;
  public setOnRender(cb: () => void) { this._onRenderCallback = cb; }

  constructor(_container: HTMLElement, targetUrl: string) {
    this.targetUrl = targetUrl;

    // Bare canvas appended directly to <body>, matching 8th Wall's own
    // default example (examples/threejs/flyer): XRExtras.FullWindowCanvas
    // pipeline module (added in start()) owns sizing/positioning from here
    // on. #ar-container/#ui-container are absolutely-positioned, z-indexed,
    // and empty of blocking content, so a body-level canvas renders behind
    // both regardless of DOM order — no layout conflict.
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'xr-canvas';
    document.body.appendChild(this.canvas);

    // Pre-create placeholder scene/camera so getScene() etc. work
    // synchronously before XR8 starts. They'll be replaced once xrScene() is available.
    // We return null for the renderer initially to avoid wasting a WebGL context.
    this._scene    = new THREE.Scene();
    this._camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
    this._renderer = null as any;
  }

  public getScene()    { return this._scene; }
  public getCamera()   { return this._camera; }
  public getRenderer() { return this._renderer; }

  public createTracker(_index = 0): IARTracker {
    // Target name is the "name" field in the JSON, which matches the filename stem
    const parts = this.targetUrl.split('/');
    const stem  = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    // Our JSON has name: "spider" / "frog"
    const name  = stem.replace('.json', '');
    console.log('[8thWall] Tracker target name:', name);
    return new XR8Tracker(name);
  }

  public async start(): Promise<void> {
    // ── 1. Load xr.js & xrextras.js ───────────────────────────────────────
    if (!window.XR8) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('[8thWall] Timeout: xrloaded never fired after 60s')),
          60000
        );

        window.addEventListener('xrloaded', () => {
          clearTimeout(timer);
          console.log('[8thWall] XR8 and XRExtras ready ✓');
          resolve();
        }, { once: true });

        // Load XRExtras first (it defines window.XRExtras). Vendored locally
        // (instead of cdn.8thwall.com) for the same reason as the /vendor
        // import map entries — some networks block that CDN.
        const sExtras = document.createElement('script');
        sExtras.src = '/external/xrextras/xrextras.js';
        document.head.appendChild(sExtras);

        // Then load XR8 which triggers xrloaded
        const sXr = document.createElement('script');
        sXr.src = '/external/xr/xr.js';
        sXr.async = true;
        sXr.setAttribute('data-preload-chunks', 'slam');
        sXr.onerror = () => { clearTimeout(timer); reject(new Error('[8thWall] xr.js failed to load')); };
        document.head.appendChild(sXr);
      });
    }

    // ── 2. Fetch target data ────────────────────────────────────────────────
    const res = await fetch(this.targetUrl);
    if (!res.ok) throw new Error(`[8thWall] Target fetch failed: ${res.status}`);
    const targetData = await res.json();
    console.log('[8thWall] Target data:', targetData.name, targetData.type);

    // ── 3. Build pipeline and run ───────────────────────────────────────────
    return new Promise<void>((resolve, reject) => {
      try {
        const XR8 = window.XR8;

        // XR8.Threejs.pipelineModule() requires window.THREE to exist globally
        (window as any).THREE = THREE;

        XR8.XrController.configure({
          imageTargetData: [targetData],
          // This app only tracks image targets (no other world-tracking
          // features), so per 8th Wall's own guidance we disable general
          // world tracking.
          disableWorldTracking: true,
        });

        const self = this;
        const XRExtras = (window as any).XRExtras;

        // Pipeline module order matches 8th Wall's own default example
        // (examples/threejs/flyer): core renderer/scene/controller modules,
        // then the default XRExtras UX modules, then our custom bridge.
        const modules = [
          XR8.GlTextureRenderer?.pipelineModule?.() ?? null,
          XR8.Threejs?.pipelineModule?.() ?? null,
          XR8.XrController.pipelineModule(),
          XRExtras?.AlmostThere?.pipelineModule?.() ?? null,
          XRExtras?.FullWindowCanvas?.pipelineModule?.() ?? null,
          XRExtras?.Loading?.pipelineModule?.() ?? null,
          XRExtras?.RuntimeError?.pipelineModule?.() ?? null,
          {
            name: 'webar-xr-bridge',
            onAttach({ stream }: { stream: MediaStream }) {
              // XR8 owns getUserMedia internally, but still hands us the raw
              // MediaStream here — grab the video track so setCameraZoom can
              // apply real camera zoom constraints (same approach as MindAR).
              self.videoTrack = stream?.getVideoTracks?.()[0] ?? null;

              // Upgrade resolution/framerate post-hoc, same as MindAR does —
              // we can't intercept 8th Wall's internal getUserMedia call
              // (it needs its own complex constraints), but applyConstraints
              // after attach is safe and gets us the same 1080p/30fps target.
              self.videoTrack?.applyConstraints({
                width:     { ideal: 1920 },
                height:    { ideal: 1080 },
                frameRate: { ideal: 30 },
              } as MediaTrackConstraints).catch(() => {
                console.warn('[8thWall] Could not upgrade camera resolution/framerate');
              });
            },
            onStart() {
              console.log('[8thWall] Pipeline onStart ✓');

              // Grab the XR8-managed Three.js objects and inject them into our managers
              if (XR8.Threejs?.xrScene) {
                const { scene, camera, renderer } = XR8.Threejs.xrScene();
                self._scene    = scene;
                self._camera   = camera;
                self._renderer = renderer;
                console.log('[8thWall] xrScene acquired ✓', { scene, camera, renderer });

                // Set the initial camera position, matching 8th Wall's own
                // documented default (examples/threejs/flyer): must be at a
                // height greater than y=0. Image target poses (position/
                // rotation/scale) are reported relative to this.
                camera.position.set(0, 3, 0);

                // Sync the XR controller's 6DoF origin/facing with our Threejs
                // camera. Without this, XR8's tracking has no synchronized
                // reference frame with the camera we render with, and tracked
                // content ends up misaligned with the physical target.
                XR8.XrController.updateCameraProjectionMatrix({
                  origin: camera.position,
                  facing: camera.quaternion,
                });

                // Notify main.ts that the scene objects have been swapped
                window.dispatchEvent(new CustomEvent('xr8-scene-ready'));
              }

              resolve();
            },
            listeners: [
              {
                event: 'reality.imagefound',
                process: (evt: any) => {
                  const dbg = document.getElementById('debug-target');
                  if (dbg) dbg.innerText = 'found: ' + evt.detail.name;
                  console.log('[8thWall] imagefound:', evt.detail.name, evt.detail);
                  window.dispatchEvent(new CustomEvent('reality.imagefound', { detail: evt.detail }));
                }
              },
              {
                event: 'reality.imageupdated',
                process: (evt: any) => {
                  window.dispatchEvent(new CustomEvent('reality.imageupdated', { detail: evt.detail }));
                }
              },
              {
                event: 'reality.imagelost',
                process: (evt: any) => {
                  const dbg = document.getElementById('debug-target');
                  if (dbg) dbg.innerText = 'lost: ' + evt.detail.name;
                  console.log('[8thWall] imagelost:', evt.detail.name);
                  window.dispatchEvent(new CustomEvent('reality.imagelost', { detail: evt.detail }));
                }
              }
            ],
            onUpdate() {
              // Pose/animation tick is called from main.ts via _onRenderCallback
              if (self._onRenderCallback) self._onRenderCallback();
            },
          },
        ].filter(Boolean);

        XR8.addCameraPipelineModules(modules);

        // XRExtras.FullWindowCanvas (in `modules` above) sizes/positions
        // this canvas once the pipeline starts.
        XR8.run({ canvas: this.canvas });

      } catch (err) {
        console.error('[8thWall] Setup threw:', err);
        reject(err);
      }
    });
  }

  public stop(): void {
    try {
      window.XR8?.stop();
      window.XR8?.clearCameraPipelineModules();
    } catch (e) {
      console.warn('[8thWall] stop() error:', e);
    }
  }

  public async setCameraZoom(level: number): Promise<number> {
    if (!this.videoTrack) return 1;
    try {
      const caps: any = this.videoTrack.getCapabilities?.() ?? {};
      if (!caps.zoom) return 1;
      const minZoom = caps.zoom.min ?? 1;
      const maxZoom = caps.zoom.max ?? level;
      const safeZoom = Math.min(Math.max(level, minZoom), maxZoom);
      await this.videoTrack.applyConstraints({ advanced: [{ zoom: safeZoom } as any] });
      return safeZoom;
    } catch {
      console.warn('[8thWall] Camera zoom not supported on this device');
      return 1;
    }
  }
  public async toggleTorch(): Promise<boolean> { return false; }
  public isTorchOn(): boolean { return this.torchOn; }
}
