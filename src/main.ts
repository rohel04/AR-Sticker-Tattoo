import * as THREE from 'three';
import { MindARManager } from './ar/MindARManager';
import { XREngineManager } from './ar/XREngineManager';
import { IARManager } from './ar/IARManager';
import { ThreeScene } from './three/ThreeScene';
import { ModelLoader } from './three/ModelLoader';
import { AnimationController } from './three/AnimationController';
import { campaigns, arConfig as defaultConfig } from './config/arConfig';

// ── Monkeypatch getUserMedia (Only for MindAR) ─────────────────────────────
// MindAR calls getUserMedia internally with low-res defaults.
// We intercept and upgrade it. But we MUST NOT do this for 8th Wall,
// because 8th Wall expects to read its own complex constraints (like width.min).
const is8thWall = new URLSearchParams(window.location.search).get('engine') === '8thwall';

if (!is8thWall) {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (constraints && constraints.video) {
      const origFacing = typeof constraints.video === 'object'
        ? (constraints.video as MediaTrackConstraints).facingMode
        : undefined;
      
      // Only merge safe defaults for MindAR.
      // 720p, not 1080p: MindAR's tracker runs its per-frame detection at
      // the raw video resolution (no internal downscale), so 1080p roughly
      // doubles tracking CPU cost for no accuracy benefit and can starve
      // the frame rate the low-lag filter settings rely on.
      constraints.video = {
        facingMode: origFacing || { ideal: 'environment' },
        width:      { ideal: 1280 },
        height:     { ideal: 720 },
        frameRate:  { ideal: 30 },
      };
    }
    return originalGetUserMedia(constraints);
  };
}


document.addEventListener('DOMContentLoaded', () => {
  const arContainer = document.getElementById('ar-container')!;
  const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
  const btnTorch = document.getElementById('btn-torch') as HTMLButtonElement;
  const controlsContainer = document.getElementById('controls-container')!;
  const interactiveUi = document.getElementById('interactive-ui')!;
  const targetStatus = document.getElementById('target-status')!;
  const statusText = document.getElementById('status-text')!;

  // Debug panel
  const dbgAr     = document.getElementById('dbg-ar')!;
  const dbgCam    = document.getElementById('dbg-cam')!;
  const dbgTarget = document.getElementById('dbg-target')!;
  const dbgModel  = document.getElementById('dbg-model')!;
  const dbgPose   = document.getElementById('dbg-pose')!;

  // -- Dynamic Campaign Mapping (Phase 9 & 10) --
  const urlParams = new URLSearchParams(window.location.search);
  const paramId = urlParams.get('id') || urlParams.get('campaign');
  const engineParam = urlParams.get('engine') || 'mindar';
  
  const pathParts = window.location.pathname.split('/');
  const pathId = pathParts[pathParts.length - 1]; 

  const activeCampaignId = (paramId && campaigns[paramId]) 
    ? paramId 
    : (campaigns[pathId] ? pathId : "tiger-001");

  const config = campaigns[activeCampaignId] || defaultConfig;

  console.log('[AR-MAIN] DOMContentLoaded triggered');
  console.log('[AR-MAIN] Active Campaign:', config.id);

  // -- Initialize AR + Three layers --
  let arManager: IARManager;
  if (engineParam === '8thwall') {
    const targetUrl = config.targetUrl8thWall || config.targetUrl;
    arManager = new XREngineManager(arContainer, targetUrl);
  } else {
    arManager = new MindARManager(arContainer, config.targetUrl);
  }

  const threeScene   = new ThreeScene(
    arManager.getScene(),
    arManager.getCamera(),
    arManager.getRenderer(),
    engineParam !== '8thwall'
  );
  const tracker = arManager.createTracker();

  let animController: AnimationController | null = null;
  let animButtons: HTMLButtonElement[] = [];

  // -- Pinch to Zoom State --
  let initialPinchDistance = -1;
  let initialModelScale = config.scale;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && threeScene.trackedModel) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      initialModelScale = threeScene.trackedModel.userData.baseScale || config.scale;
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialPinchDistance > 0 && threeScene.trackedModel) {
      // e.preventDefault(); // Optional
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      
      const scaleFactor = currentDistance / initialPinchDistance;
      const absoluteBaseScale = config.scale;
      
      // Calculate and clamp scale between 0.1x and 5x of config scale
      let newScale = initialModelScale * scaleFactor;
      newScale = Math.max(absoluteBaseScale * 0.1, Math.min(newScale, absoluteBaseScale * 5));
      
      // Update baseScale so ThreeScene doesn't overwrite it on the next frame
      threeScene.trackedModel.userData.baseScale = newScale;
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      initialPinchDistance = -1;
    }
  });

  // -- Load model in the background immediately --
  const modelLoader = new ModelLoader();
  statusText.innerText = `Loading model (${config.id})...`;

  // For 8th Wall, XR8.Threejs swaps the scene AFTER start() resolves, and
  // that can race the (independent, network-bound) model load in either
  // direction. Track both readiness signals and attach the model as soon as
  // both are true — registering this listener only inside the model-load
  // .then() (as before) missed the event whenever xr8-scene-ready fired
  // first, silently leaving the model attached to nothing.
  let loadedModel: THREE.Group | null = null;
  let xr8SceneIsReady = false;
  const attachModelToXR8SceneIfReady = () => {
    if (!loadedModel || !xr8SceneIsReady) return;
    threeScene.swapEngineObjects(arManager.getScene(), arManager.getCamera(), arManager.getRenderer());
    threeScene.setTrackedModel(loadedModel, config.scale);
    console.log('[AR] Model attached to XR8 scene');
  };

  if (engineParam === '8thwall') {
    threeScene.autoResize = false;
    window.addEventListener('xr8-scene-ready', () => {
      xr8SceneIsReady = true;
      attachModelToXR8SceneIfReady();
    }, { once: true });
  }

  modelLoader.loadCharacter(config.modelUrl)
    .then(({ model, animations }) => {
      dbgModel.innerText = 'true';
      statusText.innerText = `Model [${config.id}] loaded. Press Start AR.`;

      if (animations.length > 0) {
        animController = new AnimationController(model, animations);
        animController.playAnimation(config.defaultAnimation);
        
        animations.forEach(anim => {
          const btn = document.createElement('button');
          btn.innerText = anim.name;
          
          if (anim.name === config.defaultAnimation) {
            btn.classList.add('active-anim');
          }
          
          btn.addEventListener('click', () => {
            if (!animController) return;
            animController.playAnimation(anim.name);
            
            animButtons.forEach(b => b.classList.remove('active-anim'));
            btn.classList.add('active-anim');
            
            if (anim.name !== config.defaultAnimation) {
              setTimeout(() => {
                animController!.playAnimation(config.defaultAnimation);
                animButtons.forEach(b => b.classList.remove('active-anim'));
                const defaultBtn = animButtons.find(b => b.innerText === config.defaultAnimation);
                if (defaultBtn) defaultBtn.classList.add('active-anim');
              }, 5000);
            }
          });
          
          controlsContainer.appendChild(btn);
          animButtons.push(btn);
        });
      }

      if (engineParam === '8thwall') {
        loadedModel = model;
        attachModelToXR8SceneIfReady();
      } else {
        threeScene.setTrackedModel(model, config.scale);
      }
      console.log('[AR] Model loaded, animations:', animations.map(a => a.name));
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      statusText.innerText = `Model load error: ${msg}`;
      dbgModel.innerText = 'error';
    });

  // -- Start AR button --
  btnStart.addEventListener('click', async () => {
    btnStart.style.display = 'none';
    
    // Hide status panel entirely to make room for AR
    const statusPanel = document.getElementById('status-panel');
    if (statusPanel) statusPanel.style.display = 'none';

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(`Camera API missing. Secure context: ${window.isSecureContext}`);
      }

      const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      probe.getTracks().forEach(t => t.stop());

      await arManager.start();

      dbgAr.innerText  = 'true';
      dbgCam.innerText = 'active';

      // Show interactive UI and target status
      interactiveUi.style.display = 'flex';
      targetStatus.style.display = 'block';

      // Show scan guide immediately (target not yet found)
      const scanGuide = document.getElementById('scan-guide')!;
      scanGuide.style.display = 'flex';

      // Wire up camera zoom buttons
      const zoomBtns = document.querySelectorAll<HTMLButtonElement>('.zoom-btn');
      zoomBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
          const level = parseFloat(btn.dataset.zoom || '2');
          await arManager.setCameraZoom(level);
          zoomBtns.forEach(b => b.classList.remove('active-zoom'));
          btn.classList.add('active-zoom');
        });
      });

      // Wire up torch toggle
      btnTorch.addEventListener('click', async () => {
        const isOn = await arManager.toggleTorch();
        btnTorch.innerText = isOn ? '🔦 Torch ON' : '🔦 Torch';
        btnTorch.style.background = isOn ? '#ff3b3b' : 'white';
        btnTorch.style.color = isOn ? 'white' : 'black';
      });

      // -- Render loop --
      let isTargetVisible = false;

      const tick = () => {
        const pose = tracker.getPose();
        threeScene.updateTrackedPose(pose);

        if (pose.visible) {
          const p = pose.position;
          const c = threeScene.camera.position;
          dbgPose.innerText =
            `p(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ` +
            `cam(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`;
        }

        // Target Status UI Update
        const currentlyVisible = !!(pose && pose.visible);
        
        if (currentlyVisible !== isTargetVisible) {
          isTargetVisible = currentlyVisible;
          dbgTarget.innerText = isTargetVisible ? 'found' : 'lost';
          
          if (isTargetVisible) {
            targetStatus.innerText = 'Target Found';
            targetStatus.classList.add('found');
            scanGuide.style.display = 'none';
          } else {
            targetStatus.innerText = 'Target Lost';
            targetStatus.classList.remove('found');
            scanGuide.style.display = 'flex';
          }
        }

        const dt = threeScene.getDeltaTime();
        if (animController) {
          animController.update(dt);
        }
      };

      if (engineParam === '8thwall') {
        // XR8.Threejs owns the GL context and automatically calls renderer.render()
        // inside its pipeline. We only need to run our logic tick to update animations/pose.
        (arManager as any).setOnRender?.(() => {
          tick();
        });
      } else {
        // MindAR: standard RAF loop
        const loop = () => {
          requestAnimationFrame(loop);
          tick();
          threeScene.render();
        };
        loop();
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (statusPanel) {
        statusPanel.style.display = 'block';
        statusText.innerText = `AR Error: ${msg}`;
      }
      dbgAr.innerText = 'error';
      btnStart.style.display = 'block';
    }
  });

  // -- Target tracking events --
  document.addEventListener('ar-target-found', () => {
    dbgTarget.innerText  = 'detected ✓';
    statusText.innerText = '🎯 Target found!';
  });

  document.addEventListener('ar-target-lost', () => {
    dbgTarget.innerText  = 'not detected';
    statusText.innerText = 'Scan the target image';
  });
});
