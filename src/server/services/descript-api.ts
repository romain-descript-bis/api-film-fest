const BASE = 'https://descriptapi.com/v1';

function authHeader(overrideKey?: string) {
  const key = overrideKey || process.env.DESCRIPT_API_KEY;
  if (!key) throw new Error('DESCRIPT_API_KEY not set');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export interface DescriptJob {
  job_id: string;
  job_type: string;
  job_state: 'running' | 'stopped';
  created_at: string;
  stopped_at?: string;
  drive_id?: string;
  project_id?: string;
  project_url?: string;
  result?: {
    status: 'success' | 'error';
    agent_response?: string;
    media_status?: Record<string, { status: string; duration_seconds?: number }>;
    media_seconds_used?: number;
    ai_credits_used?: number;
    error?: string;
  };
  progress?: { label: string; last_update_at: string };
}

export async function importMedia(options: {
  projectName?: string;
  projectId?: string;
  addMedia: Record<string, { url: string }>;
  apiKey?: string;
}): Promise<{ jobId: string; projectId: string; projectUrl: string }> {
  const body: Record<string, unknown> = { add_media: options.addMedia };
  if (options.projectName) body.project_name = options.projectName;
  if (options.projectId) body.project_id = options.projectId;

  const res = await fetch(`${BASE}/jobs/import/project_media`, {
    method: 'POST',
    headers: authHeader(options.apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Descript import error: ${res.status} ${await res.text()}`);
  const data = await res.json() as DescriptJob;
  return { jobId: data.job_id, projectId: data.project_id!, projectUrl: data.project_url! };
}

export async function agentEdit(options: {
  projectId: string;
  prompt: string;
  apiKey?: string;
}): Promise<{ jobId: string; projectUrl: string }> {
  const res = await fetch(`${BASE}/jobs/agent`, {
    method: 'POST',
    headers: authHeader(options.apiKey),
    body: JSON.stringify({ project_id: options.projectId, prompt: options.prompt }),
  });
  if (!res.ok) throw new Error(`Descript agent error: ${res.status} ${await res.text()}`);
  const data = await res.json() as DescriptJob;
  return { jobId: data.job_id, projectUrl: data.project_url! };
}

export async function getJob(jobId: string, apiKey?: string): Promise<DescriptJob> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, { headers: authHeader(apiKey) });
  if (!res.ok) throw new Error(`Descript getJob error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<DescriptJob>;
}

export async function pollJob(
  jobId: string,
  onProgress?: (label: string) => void,
  intervalMs = 3000,
  apiKey?: string,
): Promise<DescriptJob> {
  while (true) {
    const job = await getJob(jobId, apiKey);
    if (job.progress?.label) onProgress?.(job.progress.label);
    if (job.job_state === 'stopped') {
      if (job.result?.status === 'error') {
        throw new Error(`Descript job failed: ${job.result.error ?? 'unknown error'}`);
      }
      return job;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
