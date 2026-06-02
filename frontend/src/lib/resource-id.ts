/**
 * Persistent resource ID for the current browser.
 *
 * This is Mastra's resourceId concept — it identifies the "user" across all
 * their conversation threads. Since the app has no login, we generate a UUID
 * on first visit and persist it in localStorage so the same user sees their
 * own thread history after a page refresh.
 */

const STORAGE_KEY = "minds_resource_id";

export function getResourceId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (e.g. private browsing restrictions)
    return "anonymous";
  }
}
