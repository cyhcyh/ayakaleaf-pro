import { ui } from '@modules/site-settings/frontend/js/ui'
import { createContext, useContext, useState } from "react";
import type { ToolSpec } from "../agent/tools";
import { api } from "./api";
import "./style.scss";

export const ReviewChatContext = createContext<{
  projectId: string;
  chatId: string;
  onApproved: (id: string) => void;
} | null>(null);

export async function approve(
  input: { scope: string; focus: string },
  projectId: string,
  chatId: string,
) {
  return await api<{ reviewId: string; approved: boolean }>(
    "/reviews/approve",
    { ...input, projectId, chatId },
  );
}

function ReviewConsent({ part, respond }: { part: any; respond: any }) {
  const context = useContext(ReviewChatContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!context || part.state !== "input-available") return null;
  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await approve(
        part.input,
        context.projectId,
        context.chatId,
      );
      context.onApproved(result.reviewId);
      respond({
        tool: "request_review",
        toolCallId: part.toolCallId,
        output: result,
      });
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="pa-review-consent">
      <strong>{ui("是否开始本轮论文审阅？")}</strong>
      <p className="mt-2 mb-2">{ui(" 范围：")}{part.input.scope === "*" ? ui("当前项目的论文") : part.input.scope}
      </p>
      <p>{part.input.focus}</p>
      <p className="pa-muted">{ui(" 同意后，具体意见会逐条写入原生审阅面板。你可以随时停止。 ")}</p>
      {error && <p role="alert">{error}</p>}
      <div className="pa-actions mb-0">
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={accept}
        >
          {busy ? ui("正在确认…") : ui("同意审阅并添加评论")}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            respond({
              tool: "request_review",
              toolCallId: part.toolCallId,
              output: { approved: false, reason: ui("用户未同意审阅。") },
            })
          }
        >{ui(" 暂不审阅 ")}</button>
      </div>
    </div>
  );
}

export const REVIEW_TOOLS: Record<string, ToolSpec> = {
  request_review: {
    label: () => ui("确认本轮审阅范围与评论"),
    body: (part, respond) => <ReviewConsent part={part} respond={respond} />,
  },
  add_review_comment: {
    label: ({ path }) => ui("添加审阅评论 · {0}", [path]),
    async run(input, { projectId, chatId, actions, signal }) {
      await api(
        "/reviews/check",
        { projectId, chatId, reviewId: input.reviewId, path: input.path },
        signal,
      );
      signal.throwIfAborted();
      return await actions.commentOnQuote(
        input.path,
        input.quote,
        input.content,
        signal,
      );
    },
  },
  list_review_comments: {
    label: () => ui("阅读已有评论"),
    run: async (_input, { projectId, signal }) =>
      await api("/reviews/comments", { projectId }, signal),
  },
  list_references: { label: () => ui("查找项目文件与参考资料") },
  read_reference: {
    label: ({ projectPath, id, page }) =>
      ui("阅读参考资料 · {0}{1}", [projectPath || id, page ? ui(" · 第 {0} 页起", [page]) : ""]),
  },
  read_webpage: { label: ({ url }) => ui("阅读网页 · {0}", [url]) },
  search_references: { label: ({ query }) => ui("检索参考资料 · {0}", [query]) },
};
