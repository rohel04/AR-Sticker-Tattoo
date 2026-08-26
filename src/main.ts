import { WebARManager } from './ar/WebARManager';
import { ThreeScene } from './three/ThreeScene';
import { ModelLoader } from './three/ModelLoader';
import { AnimationController } from './three/AnimationController';
import { campaigns, arConfig as defaultConfig } from './config/arConfig';

// ── Monkeypatch getUserMedia to control the camera feed MindAR requests ──
// MindAR requests camera constraints internally and doesn't expose resolution settings.
// By intercepting this call, we control what the browser negotiates from the start.
// 720p, not 1080p: MindAR's tracker runs its per-frame detection at the raw
// video resolution (no internal downscale), so 1080p roughly doubles tracking
// CPU cost for no accuracy benefit and can starve the frame rate the low-lag
// filter settings in WebARManager.ts rely on.
const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async function (constraints) {
  if (constraints && constraints.video) {
    console.log('[WebAR] Intercepted camera request. Upgrading constraints...');
    constraints.video = {
      // @ts-ignore
      facingMode: constraints.video.facingMode || 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    };
  }
  return originalGetUserMedia(constraints);
};

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

  // -- Dynamic Campaign Mapping (Phase 9 & 10) --
  const urlParams = new URLSearchParams(window.location.search);
  const paramId = urlParams.get('id') || urlParams.get('campaign');
  
  const pathParts = window.location.pathname.split('/');
  const pathId = pathParts[pathParts.length - 1]; 

  const activeCampaignId = (paramId && campaigns[paramId]) 
    ? paramId 
    : (campaigns[pathId] ? pathId : "tiger-001");

  const config = campaigns[activeCampaignId] || defaultConfig;

  console.log('[AR-MAIN] DOMContentLoaded triggered');
  console.log('[AR-MAIN] Active Campaign:', config.id);

  // -- Initialize AR + Three layers --
  const webarManager = new WebARManager(arContainer, config.targetUrl);
  const threeScene   = new ThreeScene(
    webarManager.getScene(),
    webarManager.getCamera(),
    webarManager.getRenderer()
  );
  const tracker = webarManager.createTracker();

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

      threeScene.setTrackedModel(model, config.scale);
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

      await webarManager.start();

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
          await webarManager.setCameraZoom(level);
          zoomBtns.forEach(b => b.classList.remove('active-zoom'));
          btn.classList.add('active-zoom');
        });
      });

      // Wire up torch toggle
      btnTorch.addEventListener('click', async () => {
        const isOn = await webarManager.toggleTorch();
        btnTorch.innerText = isOn ? '🔦 Torch ON' : '🔦 Torch';
        btnTorch.style.background = isOn ? '#ff3b3b' : 'white';
        btnTorch.style.color = isOn ? 'white' : 'black';
      });

      // -- Render loop --
      let isTargetVisible = false;

      const loop = () => {
        requestAnimationFrame(loop);

        const pose = tracker.getPose();
        threeScene.updateTrackedPose(pose);
        
        // Target Status UI Update
        const currentlyVisible = !!(pose && pose.visible);
        
        if (currentlyVisible !== isTargetVisible) {
          isTargetVisible = currentlyVisible;
          dbgTarget.innerText = isTargetVisible ? 'found' : 'lost';
          
          if (isTargetVisible) {
            targetStatus.innerText = 'Target Found';
            targetStatus.classList.add('found');
            // Hide scan guide — target acquired!
            scanGuide.style.display = 'none';
          } else {
            targetStatus.innerText = 'Target Lost';
            targetStatus.classList.remove('found');
            // Show scan guide again — help user re-acquire
            scanGuide.style.display = 'flex';
          }
        }

        const dt = threeScene.getDeltaTime();
        if (animController) {
          animController.update(dt);
        }

        threeScene.render();
      };
      loop();

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
