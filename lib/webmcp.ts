import { createSearch, Dataset, emptyFilters } from "./conference";
import { setBookmark, getSaved } from "./storage";
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
export type ModelContext = {
  registerTool: (tool: Tool, options?: { signal: AbortSignal }) => void | Promise<void>;
};
export function createTools(data: Dataset): Tool[] {
  const search = createSearch(data);
  return [
    {
      name: "search_papers",
      title: "Search ECCV papers",
      description:
        "Search the loaded ECCV 2026 papers by title, author or topic. Returns up to 50 matches and saved status.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        const v = input as { query?: unknown };
        if (!v || typeof v.query !== "string" || v.query.length > 1000)
          throw Error("query must be a string of at most 1000 characters");
        const rows = search(v.query, emptyFilters);
        return {
          total: rows.length,
          papers: rows
            .slice(0, 50)
            .map((p) => ({ id: p.id, title: p.title, saved: getSaved().includes(p.id) })),
        };
      },
    },
    {
      name: "set_paper_bookmark",
      title: "Save or remove an ECCV paper",
      description:
        "Save a paper or remove its bookmark in the same device-local shortlist shown in the app.",
      inputSchema: {
        type: "object",
        properties: { paperId: { type: "string" }, saved: { type: "boolean" } },
        required: ["paperId", "saved"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const v = input as { paperId?: unknown; saved?: unknown };
        if (
          !v ||
          typeof v.paperId !== "string" ||
          typeof v.saved !== "boolean" ||
          !data.papers.some((p) => p.id === v.paperId)
        )
          throw Error("A known paper ID and boolean saved value are required");
        setBookmark(v.paperId, v.saved);
        return { paperId: v.paperId, saved: getSaved().includes(v.paperId) };
      },
    },
  ];
}
export function registerTools(data: Dataset, context?: ModelContext) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  for (const tool of createTools(data)) {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(
        () => {},
      );
    } catch {
      /* Unsupported experimental API must not break browsing. */
    }
  }
  return () => lifecycle.abort();
}
