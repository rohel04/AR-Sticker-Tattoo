import { WebARManager } from './ar/WebARManager';
import { ThreeScene } from './three/ThreeScene';
import { ModelLoader } from './three/ModelLoader';
import { AnimationController } from './three/AnimationController';
import { campaigns, arConfig as defaultConfig } from './config/arConfig';

document.addEventListener('DOMContentLoaded', () => {
  const arContainer = document.getElementById('ar-container')!;
  const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
  const controlsContainer = document.getElementById('controls-container')!;
  const interactiveUi = document.getElementById('interactive-ui')!;
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
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
  let modelLoaded = false;
  let animButtons: HTMLButtonElement[] = [];

  // -- Load model in the background immediately --
  const modelLoader = new ModelLoader();
  statusText.innerText = `Loading model (${config.id})...`;

  modelLoader.loadCharacter(config.modelUrl)
    .then(({ model, animations }) => {
      modelLoaded = true;
      dbgModel.innerText = 'true';
      statusText.innerText = `Model [${config.id}] loaded. Press Start AR.`;

      if (animations.length > 0) {
        animController = new AnimationController(model, animations);
        animController.playAnimation(config.defaultAnimation);
        
        // Dynamically create a button for EVERY animation found in the GLB
        animations.forEach(anim => {
          const btn = document.createElement('button');
          btn.innerText = anim.name;
          
          if (anim.name === config.defaultAnimation) {
            btn.classList.add('active-anim');
          }
          
          btn.addEventListener('click', () => {
            if (!animController) return;
            animController.playAnimation(anim.name);
            
            // UI Update: Highlight active button
            animButtons.forEach(b => b.classList.remove('active-anim'));
            btn.classList.add('active-anim');
            
            // Revert to default animation after 5 seconds if it's not the default
            if (anim.name !== config.defaultAnimation) {
              setTimeout(() => {
                animController!.playAnimation(config.defaultAnimation);
                animButtons.forEach(b => b.classList.remove('active-anim'));
                
                // Re-highlight the default button
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

      // Wire up Zoom slider
      zoomSlider.addEventListener('input', (e) => {
        const zoomValue = parseFloat((e.target as HTMLInputElement).value);
        if (threeScene.trackedModel) {
          // Multiply the original baseScale by the zoom factor
          const baseScale = threeScene.trackedModel.userData.baseScale || config.scale;
          const newScale = baseScale * zoomValue;
          threeScene.trackedModel.scale.set(newScale, newScale, newScale);
        }
      });

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

    try {
      statusText.innerText = 'Requesting camera...';

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(`Camera API missing. Secure context: ${window.isSecureContext}`);
      }

      const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      probe.getTracks().forEach(t => t.stop());

      statusText.innerText = 'Starting AR engine...';
      await webarManager.start();

      dbgAr.innerText  = 'true';
      dbgCam.innerText = 'active';
      statusText.innerText = modelLoaded
        ? 'Scan the target image'
        : 'Model still loading…';

      // Show interactive UI
      interactiveUi.style.display = 'flex';

      // -- Render loop --
      const loop = () => {
        const pose = tracker.getPose();
        threeScene.updateTrackedPose(pose);

        const dt = threeScene.getDeltaTime();
        animController?.update(dt);

        threeScene.render();
        requestAnimationFrame(loop);
      };
      loop();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      statusText.innerText = `Error: ${msg}`;
      btnStart.style.display = 'inline-block';
      console.error('[AR] Start failed:', err);
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
