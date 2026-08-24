import * as THREE from 'three';

export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private animations: Map<string, THREE.AnimationAction> = new Map();
  private currentAction: THREE.AnimationAction | null = null;

  constructor(model: THREE.Group, animations: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);
    
    // Create actions for all animations
    animations.forEach((clip) => {
      this.animations.set(clip.name, this.mixer.clipAction(clip));
    });
  }

  public playAnimation(name: string, fadeDuration: number = 0.5) {
    const action = this.animations.get(name);
    if (!action) {
      console.warn(`Animation ${name} not found!`);
      return;
    }

    if (this.currentAction === action) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeDuration);
    }

    action.reset().fadeIn(fadeDuration).play();
    this.currentAction = action;
  }

  public stopAnimation() {
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
  }

  public update(deltaTime: number) {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
  }
}
