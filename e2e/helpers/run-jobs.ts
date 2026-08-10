import { expect } from "@playwright/test";

export async function runInternalJobsEventually() {
  let lastBody = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      "http://127.0.0.1:3004/api/internal/jobs/run",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.INTERNAL_JOB_TOKEN}` },
      },
    );
    lastBody = await response.text();
    if (response.ok) return;
    if (response.status !== 409 || !lastBody.includes("ALREADY_RUNNING")) {
      expect(response.ok, lastBody).toBe(true);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Interní runner zůstal obsazený: ${lastBody}`);
}
