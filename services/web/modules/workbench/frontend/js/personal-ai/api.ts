import getMeta from "@/utils/meta";

export type Connection = {
  id: string;
  name: string;
  kind: "cloud" | "codex" | "google";
  baseURL: string;
  apiKey?: string;
  clearKey?: boolean;
  hasKey?: boolean;
  authStatus?: string;
  credentialRevision?: string;
  catalog?: { models: ModelInfo[]; updatedAt: string } | null;
};
export type ModelInfo = { id: string; name: string; thinkingModes: string[]; reasoningEfforts: string[]; contextWindow: number; outputLimit: number; source: string };
export type Binding = { connectionId: string; model: string; thinking?: string; reasoningEffort?: string };
export type Compression = { enabled: boolean; contextWindow: number; summaryContextWindow: number; threshold: number; targetRatio: number; protectLast: number; protectFirst: number; summaryMaxTokens: number };
export type Profile = {
  revision: string;
  connections: Connection[];
  bindings: Record<"chat" | "fix" | "review" | "translation" | "compression", Binding>;
  compression: Compression;
  siteDefault?: { model: string } | null;
  translation: {
    enabled: boolean;
    provider: string;
    target: string;
    googleConnectionId: string;
  };
};

export async function api<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/personal-ai${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Csrf-Token": getMeta("ol-csrfToken"),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || `请求失败（HTTP ${response.status}）`);
  return result;
}

export function openAiSettings() {
  window.dispatchEvent(
    new CustomEvent("ui.focus-setting", { detail: "personalAi" }),
  );
}

export function settingsChanged(profile: Profile) {
  window.dispatchEvent(
    new CustomEvent("personal-ai:settings", { detail: profile }),
  );
}
