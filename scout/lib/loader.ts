import { validateDataset, Dataset } from "./conference";
const CACHE = "eccv-scout-data-v1";
const URL = "/data/conference.json";
export async function loadConference(): Promise<{
  data: Dataset;
  cached: boolean;
  warning: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw Error("Download failed");
    const data = validateDataset(await response.json());
    let warning = "";
    try {
      if ("caches" in window) {
        const cache = await caches.open(CACHE);
        await cache.put(
          URL,
          new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }),
        );
      } else warning = "Offline storage is unavailable in this browser.";
    } catch {
      warning = "Offline storage is unavailable. Keep this page open for this visit.";
    }
    return { data, cached: response.headers.get("X-Scout-Offline") === "true", warning };
  } catch {
    if ("caches" in window) {
      const response = await caches.match(URL);
      if (response)
        return {
          data: validateDataset(await response.json()),
          cached: true,
          warning: "Using the last downloaded conference data.",
        };
    }
    throw Error("Could not load the conference. Connect to the internet and retry.");
  } finally {
    clearTimeout(timer);
  }
}
