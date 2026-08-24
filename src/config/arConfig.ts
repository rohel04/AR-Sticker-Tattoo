export interface ARCampaign {
  id: string;
  targetId: string;
  modelUrl: string;
  targetUrl: string;
  defaultAnimation: string;
  scale: number;
}

export const campaigns: Record<string, ARCampaign> = {
  "tiger-001": {
    id: "tiger-001",
    targetId: "target-001",
    modelUrl: "/assets/RobotExpressive.glb",
    targetUrl: "/assets/targets.mind", // compiled raccoon target for testing
    defaultAnimation: "Idle",
    scale: 0.1
  },
  "spider-001": {
    id: "spider-001",
    targetId: "target-002",
    modelUrl: "/assets/spider.glb",
    targetUrl: "/assets/spider.mind",
    defaultAnimation: "Idle",
    scale: 0.1
  }
};

// Default fallback config
export const arConfig = campaigns["tiger-001"];
