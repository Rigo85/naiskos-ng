import { executePlannerJob, PlannerJob } from './collage-planner';

addEventListener('message', ({ data }: MessageEvent<{ id: number; job: PlannerJob }>) => {
  try {
    const started = performance.now();
    postMessage({ id: data.id, scenes: executePlannerJob(data.job), elapsedMs: performance.now() - started });
  } catch {
    postMessage({ id: data.id, error: 'planner-failed' });
  }
});
