import { Scene, PerspectiveCamera, WebGLRenderer } from 'three';

import * as THREE from 'three';

export interface TargetPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}

export interface IARTracker {
  getPose(): TargetPose;
  visible: boolean;
}

export interface IARManager {
    start(): Promise<void>;
    stop(): void;
    
    getScene(): Scene;
    getCamera(): PerspectiveCamera;
    getRenderer(): WebGLRenderer;
    
    createTracker(index?: number): IARTracker;
    
    setCameraZoom(zoomLevel: number): Promise<number>;
    toggleTorch(): Promise<boolean>;
    isTorchOn(): boolean;
}
