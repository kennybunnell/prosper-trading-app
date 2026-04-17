/**
 * Scan Job Manager
 * 
 * Manages long-running scan jobs (BPS, IC, CSP) that exceed the 300s gateway timeout.
 * Pattern: client fires startScan → gets jobId → polls pollScan every 3s until done.
 * 
 * Jobs are stored in memory (Map) — they survive for 10 minutes then are cleaned up.
 * No DB needed: results are transient scan data, not persisted state.
 */

export type ScanJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface ScanJobProgress {
  batchCurrent: number;
  batchTotal: number;
  symbolsDone: number;
  symbolsTotal: number;
  opportunitiesFound: number;
}

export interface ScanJob {
  id: string;
  userId: number;
  status: ScanJobStatus;
  progress: ScanJobProgress;
  results: any[] | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

// In-memory job store — keyed by jobId
const jobs = new Map<string, ScanJob>();

// Clean up jobs older than 10 minutes every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, job] of Array.from(jobs.entries())) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

export function createScanJob(userId: number, symbolsTotal: number): ScanJob {
  const id = `scan_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: ScanJob = {
    id,
    userId,
    status: 'pending',
    progress: {
      batchCurrent: 0,
      batchTotal: Math.ceil(symbolsTotal / 20),
      symbolsDone: 0,
      symbolsTotal,
      opportunitiesFound: 0,
    },
    results: null,
    error: null,
    createdAt: Date.now(),
    completedAt: null,
  };
  jobs.set(id, job);
  return job;
}

export function getScanJob(jobId: string): ScanJob | undefined {
  return jobs.get(jobId);
}

export function updateScanJobProgress(
  jobId: string,
  patch: Partial<ScanJobProgress> & { status?: ScanJobStatus }
): void {
  const job = jobs.get(jobId);
  if (!job) return;
  if (patch.status) job.status = patch.status;
  Object.assign(job.progress, patch);
}

export function completeScanJob(jobId: string, results: any[]): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'done';
  job.results = results;
  job.completedAt = Date.now();
}

export function failScanJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'error';
  job.error = error;
  job.completedAt = Date.now();
}
