import * as THREE from 'three';
import { TargetPose } from '../ar/WebARManager';

export class ThreeScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  public trackedModel: THREE.Group | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.clock = new THREE.Clock();

    this.setupRenderer();
    this.setupLighting();
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupRenderer() {
    // ── 1. Retina / high-DPI pixel ratio ──────────────────────────────────
    // THE #1 reason commercial AR looks sharper. Modern phones have 2.5-3x
    // physical pixels. Without this we render at 1x and it looks blurry.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // ── 2. Transparent background so camera feed shows through ─────────────
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;

    // ── 3. sRGB colour encoding (r149 API) ────────────────────────────────
    // @ts-ignore
    this.renderer.outputEncoding = THREE.sRGBEncoding;

    // ── 4. ACESFilmic tone mapping ─────────────────────────────────────────
    // Gives cinematic contrast — avoids washed-out whites and blown highlights.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // ── 5. Physically correct light attenuation ────────────────────────────
    // @ts-ignore – r149 API
    this.renderer.physicallyCorrectLights = true;

    // ── 6. Soft shadow maps ────────────────────────────────────────────────
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
    // Image-Based Lighting: makes PBR metallic/roughness materials show
    // realistic reflections. This is what gives commercial AR that "polished"
    // look on shiny or metallic models. No external HDR file needed.
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
        this.trackedModel.position.copy(pose.position);
        this.trackedModel.quaternion.copy(pose.quaternion);
        const baseScale = this.trackedModel.userData.baseScale || 1.0;
        this.trackedModel.scale.copy(pose.scale).multiplyScalar(baseScale);
      } else {
        this.trackedModel.visible = false;
      }
    }
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  public getDeltaTime(): number {
    return this.clock.getDelta();
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }
}

