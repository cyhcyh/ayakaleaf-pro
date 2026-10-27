import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collection } from "./ProfileStore.mjs";
import { projectWrite } from './WorkspaceLifecycle.mjs';
import { readPublicURL, plainHTML } from "./PublicWeb.mjs";
import ProjectLocator from "../../../../../app/src/Features/Project/ProjectLocator.mjs";
import ProjectEntityHandler from "../../../../../app/src/Features/Project/ProjectEntityHandler.mjs";
import ProjectZipStreamManager from "../../../../../app/src/Features/Downloads/ProjectZipStreamManager.mjs";
import { readDoc } from "../../../../mcp-server/app/src/FileTools.mjs";

const exec = promisify(execFile);
const root =
  process.env.PERSONAL_AI_REFERENCE_DIR ||
  "/var/lib/overleaf/data/personal-ai/references";
const MAX_BYTES = 8 * 1024 * 1024;

function referencePath(row) {
  if (!/^[a-f0-9]{24}$/i.test(String(row.userId)) || !/^[a-f0-9-]{36}$/i.test(row._id)) throw new Error('参考文件路径无效');
  return row.storageVersion === 2 ? path.join(projectReferenceDirectory(row.projectId), String(row.userId), row._id) : path.join(root, String(row.userId), row._id);
}

function projectReferenceDirectory(projectId) {
  if (!/^[a-f0-9]{24}$/i.test(String(projectId))) throw new Error('项目编号无效');
  return path.join(root, 'projects', String(projectId));
}

export async function removeProjectReferences(projectId) {
  const store = await collection('References');
  for await (const row of store.find({ projectId })) await fs.rm(referencePath(row), { force: true });
  await fs.rm(projectReferenceDirectory(projectId), { recursive: true, force: true });
  await store.deleteMany({ projectId });
}

export async function pdfText(data, page = 1) {
  if (!data.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("文件不是有效的 PDF");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "rogerleaf-reference-"),
  );
  try {
    const file = path.join(directory, "reference.pdf");
    await fs.writeFile(file, data);
    const { stdout: info } = await exec("pdfinfo", [file], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]) || 1;
    if (!Number.isInteger(page) || page < 1 || page > pageCount)
      throw new Error(`页码超出范围（共 ${pageCount} 页）`);
    const { stdout } = await exec(
      "pdftotext",
      [
        "-layout",
        "-enc",
        "UTF-8",
        "-f",
        String(page),
        "-l",
        String(Math.min(page + 2, pageCount)),
        file,
        "-",
      ],
      { timeout: 15000, maxBuffer: 3 * 1024 * 1024 },
    );
    return {
      pageCount,
      fromPage: page,
      toPage: Math.min(page + 2, pageCount),
      text: stdout.slice(0, 24000),
      ...(!stdout.trim() && {
        note: "这些页面没有可提取的文本，可能是扫描图像。",
      }),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function upload(userId, projectId, input) {
  if (
    typeof input.name !== "string" ||
    input.name.length > 200 ||
    typeof input.data !== "string"
  )
    throw new Error("附件格式不正确");
  const data = Buffer.from(input.data, "base64");
  if (
    !data.length ||
    data.length > MAX_BYTES ||
    data.toString("base64") !== input.data
  )
    throw new Error("附件需要小于 8 MB");
  const pdf = input.mediaType === "application/pdf";
  if (!pdf && !["text/plain", "text/markdown"].includes(input.mediaType))
    throw new Error("支持 PDF、TXT 和 Markdown 参考资料");
  if (pdf) await pdfText(data);
  const id = crypto.randomUUID();
  const directory = path.join(projectReferenceDirectory(projectId), String(userId));
  try {
    await projectWrite(projectId, async session => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, id), data, { mode: 0o600 });
    await (
      await collection("References")
    ).insertOne({
      _id: id,
      userId: String(userId),
      projectId,
      name: input.name,
      mediaType: input.mediaType,
      size: data.length,
      storageVersion: 2,
      createdAt: new Date(),
    }, { session });
    });
  } catch (error) {
    await fs.rm(path.join(directory, id), { force: true });
    throw error;
  }
  return { id, name: input.name, mediaType: input.mediaType };
}

export async function listReferences(userId, projectId) {
  const uploaded = await (await collection("References"))
    .find({ userId: String(userId), projectId }, { projection: { userId: 0 } })
    .toArray();
  const { docs, files } =
    await ProjectEntityHandler.promises.getAllEntities(projectId);
  return {
    uploaded: uploaded.map(({ _id, ...ref }) => ({ id: _id, ...ref })),
    projectFiles: [...docs, ...files].map((file) => ({
      path: file.path.slice(1),
    })),
  };
}

export async function readReference(
  userId,
  projectId,
  { id, projectPath, page = 1, offset = 0 },
) {
  let data, name, mediaType;
  if (id) {
    const reference = await (
      await collection("References")
    ).findOne({ _id: id, userId: String(userId), projectId });
    if (!reference) throw new Error("参考资料不存在或无权访问");
    data = await fs.readFile(referencePath(reference));
    ({ name, mediaType } = reference);
  } else if (projectPath) {
    const { element, type } = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: `/${projectPath.replace(/^\/+/, "")}`,
      exactCaseMatch: true,
    });
    if (type === "doc") {
      const { content } = await readDoc(projectId, projectPath);
      return {
        name: projectPath,
        offset,
        text: content.slice(offset, offset + 24000),
        nextOffset: offset + 24000 < content.length ? offset + 24000 : null,
      };
    }
    const stream = await new Promise((resolve, reject) =>
      ProjectZipStreamManager.getFileStream(
        projectId,
        element,
        (error, value) => (error ? reject(error) : resolve(value)),
      ),
    );
    const chunks = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        stream.destroy();
        throw new Error("项目参考资料超过 8 MB");
      }
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks);
    name = projectPath;
    mediaType = /\.pdf$/i.test(projectPath) ? "application/pdf" : "text/plain";
  } else throw new Error("请提供附件 ID 或项目文件路径");
  if (mediaType === "application/pdf")
    return { name, ...(await pdfText(data, page)) };
  const content = data.toString("utf8");
  return {
    name,
    offset,
    text: content.slice(offset, offset + 24000),
    nextOffset: offset + 24000 < content.length ? offset + 24000 : null,
  };
}

export async function readWebpage(url, page, offset, signal) {
  const response = await readPublicURL(url, signal);
  if (
    response.type.includes("application/pdf") ||
    response.data.subarray(0, 5).toString() === "%PDF-"
  )
    return { url: response.url, ...(await pdfText(response.data, page || 1)) };
  if (
    !/text\/(html|plain)|application\/(xhtml\+xml|json|xml)/i.test(
      response.type,
    )
  )
    throw new Error("链接未返回可阅读的网页、文本或 PDF");
  const html = response.data.toString("utf8");
  const content = response.type.includes("html") ? plainHTML(html) : html;
  return {
    url: response.url,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    text: content.slice(offset || 0, (offset || 0) + 24000),
    nextOffset:
      (offset || 0) + 24000 < content.length ? (offset || 0) + 24000 : null,
  };
}

export async function searchWeb(query, signal) {
  // A public scholarly index works without an API key and is available on
  // networks where general web search is blocked.
  try {
    const response = await readPublicURL(
      `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=8`,
      signal,
    );
    const items = JSON.parse(response.data.toString('utf8')).message?.items || [];
    const results = items.filter(item => item.URL && item.title?.[0]).map(item => ({
      title: plainHTML(item.title[0]), url: item.URL,
      ...(item.DOI && { doi: item.DOI }),
    }));
    if (results.length) return { query, source: 'Crossref', results };
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const response = await readPublicURL(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    signal,
  );
  const html = response.data.toString("utf8");
  const results = [];
  for (const match of html.matchAll(
    /<a\b([^>]*class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    let link = match[1].match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    if (!link) continue;
    const url = new URL(link, "https://html.duckduckgo.com");
    link = url.searchParams.get("uddg") || url.href;
    if (/^https?:\/\//.test(link))
      results.push({ title: plainHTML(match[2]), url: link });
    if (results.length >= 8) break;
  }
  return {
    query,
    results,
    ...(!results.length && {
      note: "搜索服务未返回结果。可以改用用户提供的链接。",
    }),
  };
}
