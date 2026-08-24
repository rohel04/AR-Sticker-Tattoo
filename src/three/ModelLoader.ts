import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

export class ModelLoader {
  private loader: GLTFLoader;

  constructor() {
    this.loader = new GLTFLoader();
  }

  public loadCharacter(modelUrl: string): Promise<{ model: THREE.Group, animations: THREE.AnimationClip[] }> {
    return new Promise((resolve, reject) => {
      console.log('[ModelLoader] Starting load:', modelUrl);

      this.loader.load(
        modelUrl,
        (gltf) => {
          console.log('[ModelLoader] Loaded OK. Animations:', gltf.animations.map((a: THREE.AnimationClip) => a.name));
          resolve({ model: gltf.scene, animations: gltf.animations });
        },
        (progress) => {
          if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            console.log(`[ModelLoader] Progress: ${pct}%`);
          }
        },
        (error: unknown) => {
          console.error('[ModelLoader] Load error:', error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }
}
