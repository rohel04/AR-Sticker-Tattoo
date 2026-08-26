import * as THREE from 'three';
import { TargetPose } from '../ar/IARManager';

export class ThreeScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer | null;
  private clock: THREE.Clock;
  public trackedModel: THREE.Group | null = null;
  public autoResize = true;

  // MindAR's anchor.matrixWorld decompose gives a real, calibrated scale
  // (pose.scale) reflecting the tracked target's detected size — the
  // pre-refactor version multiplied this into the model's scale. 8th Wall's
  // reported scale is a different, not-yet-tuned quantity, so it keeps using
  // a fixed baseScale until that's deliberately revisited.
  private useAnchorScale: boolean;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer | null,
    useAnchorScale = true,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.clock = new THREE.Clock();
    this.useAnchorScale = useAnchorScale;

    if (this.renderer) {
      this.setupRenderer();
    }
    this.setupLighting();
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  public swapEngineObjects(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.setupRenderer(); // apply our graphics settings to the new renderer
    this.setupLighting();

    if (this.trackedModel) {
      this.scene.add(this.trackedModel);
    }
  }

  private setupRenderer() {
    if (!this.renderer) return;
    // ── 1. Retina / high-DPI pixel ratio ──────────────────────────────────
    // THE #1 reason commercial AR looks sharper. Modern phones have 2.5-3x
    // pixel density, but WebGL defaults to 1x (blurry). We cap at 2x for perf.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // ── 2. Color Space & Tone Mapping (Crucial for GLTF) ──────────────────
    // Without this, models look washed out, dark, or plasticky.
    // Use sRGBEncoding for older three.js versions
    (this.renderer as any).outputEncoding = (THREE as any).sRGBEncoding;
    
    // ACESFilmic simulates a cinema camera's dynamic range (brights don't clip harshly)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // ── 3. Transparent Background (MindAR only) ───────────────────────────
    // MindAR renders a transparent canvas over a separate <video> element,
    // so clearing to transparent each frame is what lets the camera feed
    // show through. 8th Wall's XR8.Threejs renderer instead draws the
    // camera feed and the 3D scene into the SAME canvas/framebuffer via its
    // own pipeline — forcing autoClear/transparent-clear here wipes out
    // whichever of the two drew first, leaving a blank (white) canvas even
    // though tracking itself is unaffected. 8th Wall's own reference
    // integration never touches these two settings, so we only apply them
    // for MindAR (useAnchorScale doubles as "this is MindAR" — see ctor).
    if (this.useAnchorScale) {
      this.renderer.setClearColor(0x000000, 0); // Transparent black
      this.renderer.autoClear = true;
    }

    // ── 4. Physically correct light attenuation ─────────────────────────────
    // @ts-ignore – r149 API
    this.renderer.physicallyCorrectLights = true;

    // Enable basic shadow maps (optional, if models cast shadows)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  private setupLighting() {
    // ── Hemisphere light: sky/ground gradient ──────────────────────────────
    // Replaces flat ambient — gives natural sky-blue top, warm-ground bottom.
    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x442200, 0.8);
    this.scene.add(hemiLight);

    // ── Key light: sun-like directional light with soft shadows ────────────
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(2, 6, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width  = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.01;
    keyLight.shadow.camera.far  = 20;
    keyLight.shadow.bias = -0.001;
    this.scene.add(keyLight);

    // ── Fill light: cool opposite light to soften harsh shadows ───────────
    const fillLight = new THREE.DirectionalLight(0x8899ff, 0.6);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    // ── IBL environment map ───────────────────────────────────────────────
    if (!this.renderer) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      // Build a simple neutral studio env from a gradient colour
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x445566);
      const envRT = pmrem.fromScene(envScene);
      this.scene.environment = envRT.texture;
      pmrem.dispose();
    } catch (e) {
      console.warn('[ThreeScene] IBL env setup failed (non-critical):', e);
    }
  }

  public setTrackedModel(model: THREE.Group, scale: number) {
    this.trackedModel = model;
    this.trackedModel.userData.baseScale = scale;
    this.trackedModel.scale.set(scale, scale, scale);
    this.trackedModel.visible = false;

    // Enable shadow casting on every mesh inside the model
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
      }
    });

    this.scene.add(this.trackedModel);
  }

  public updateTrackedPose(pose: TargetPose) {
    if (this.trackedModel) {
      if (pose.visible) {
        this.trackedModel.visible = true;
        const baseScale = this.trackedModel.userData.baseScale || 1.0;
        if (this.useAnchorScale) {
          this.trackedModel.scale.copy(pose.scale).multiplyScalar(baseScale);
        } else {
          this.trackedModel.scale.setScalar(baseScale);
        }

        this.trackedModel.quaternion.copy(pose.quaternion);
        this.trackedModel.position.copy(pose.position);
      } else {
        this.trackedModel.visible = false;
      }
    }
  }

  private onWindowResize() {
    if (!this.autoResize) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
  }

  public getDeltaTime(): number {
    return this.clock.getDelta();
  }

  public render() {
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

