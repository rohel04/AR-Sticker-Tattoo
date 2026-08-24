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

    // Ensure transparent background for camera feed
    this.renderer.setClearColor(0x000000, 0); 
    // @ts-ignore (sRGBEncoding is deprecated but matches mind-ar's three version r149)
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    
    this.setupLighting();
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(0, 5, 10);
    this.scene.add(directionalLight);
  }

  public setTrackedModel(model: THREE.Group, scale: number) {
    this.trackedModel = model;
    this.trackedModel.userData.baseScale = scale;
    this.trackedModel.scale.set(scale, scale, scale);
    this.trackedModel.visible = false;
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
  }

  public getDeltaTime(): number {
    return this.clock.getDelta();
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }
}
