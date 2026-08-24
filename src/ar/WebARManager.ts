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

  constructor(container: HTMLElement, targetUrl: string) {
    this.mindarThree = new MindARThree({
      container,
      imageTargetSrc: targetUrl,
      filterMinCF: 0.0001,
      filterBeta: 0.001,
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

  public async start() { await this.mindarThree.start(); }
  public stop()        { this.mindarThree.stop(); }
}
