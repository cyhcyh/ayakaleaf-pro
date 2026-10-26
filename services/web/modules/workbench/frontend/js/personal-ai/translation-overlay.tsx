import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MaterialIcon from "@/shared/components/material-icon";
import { useEditorViewContext } from "@/features/ide-react/context/editor-view-context";
import { api, type Profile } from "./api";
import "./style.scss";

type Selection = { text: string; x: number; y: number };
type Translation = { translatedText: string; source: string };
const services = {
  "google-free": "Google 翻译",
  mymemory: "MyMemory · 免费",
  llm: "大语言模型 / Codex",
  google: "Google Cloud",
};

export default function TranslationOverlay() {
  const { view } = useEditorViewContext();
  const [settings, setSettings] = useState<Profile | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [provider, setProvider] = useState("google-free");
  const [target, setTarget] = useState("zh-CN");
  const [result, setResult] = useState<Translation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const popup = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLButtonElement>(null);
  const hover = useRef<ReturnType<typeof setTimeout>>();
  const close = useRef<ReturnType<typeof setTimeout>>();
  const request = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Translation>());

  useEffect(() => {
    const controller = new AbortController();
    const changed = (event: Event) => {
      const profile = (event as CustomEvent<Profile>).detail;
      cache.current.clear();
      request.current?.abort();
      setOpen(false);
      setSelection(null);
      setPinned(false);
      setSettings(profile);
      setProvider(profile.translation.provider);
      setTarget(profile.translation.target);
    };
    api<Profile>("/settings", undefined, controller.signal)
      .then((profile) =>
        changed(new CustomEvent("settings", { detail: profile })),
      )
      .catch(() => {});
    window.addEventListener("personal-ai:settings", changed);
    return () => {
      controller.abort();
      window.removeEventListener("personal-ai:settings", changed);
    };
  }, []);

  const hide = useCallback(() => {
    clearTimeout(hover.current);
    clearTimeout(close.current);
    request.current?.abort();
    setOpen(false);
    setPinned(false);
    setSelection(null);
    setExpanded(false);
  }, []);

  useEffect(() => {
    if (!settings?.translation.enabled) {
      hide();
      return;
    }
    const select = (event: Event) => {
      if (!(event.target instanceof Element) ||
          !event.target.closest(".cm-content, .textLayer")) return;
      if (
        popup.current?.contains(event.target as Node) ||
        dot.current?.contains(event.target as Node)
      ) return;
      const selected = window.getSelection();
      if (!selected?.rangeCount || selected.isCollapsed) return;
      const parent =
        selected.anchorNode instanceof Element
          ? selected.anchorNode
          : selected.anchorNode?.parentElement;
      if (!parent || popup.current?.contains(parent)) return;
      const area = parent.closest(".cm-content, .textLayer");
      if (!area) return;
      let text = selected.toString().trim();
      if (area.matches(".cm-content") && view) {
        const range = view.state.selection.main;
        if (!range.empty)
          text = view.state.doc.sliceString(range.from, range.to).trim();
      } else {
        text = text
          .replace(/([a-z])-\s*\n\s*([a-z])/gi, "$1$2")
          .replace(/\s*\n\s*/g, " ");
      }
      if (!text || text.length > 10000) return;
      const rectangles = selected.getRangeAt(0).getClientRects();
      const rectangle =
        rectangles[rectangles.length - 1] ||
        selected.getRangeAt(0).getBoundingClientRect();
      request.current?.abort();
      clearTimeout(close.current);
      setSelection({
        text,
        x: Math.max(8, Math.min(rectangle.right - 6, window.innerWidth - 32)),
        y: Math.max(8, Math.min(rectangle.bottom + 1, window.innerHeight - 32)),
      });
      setOpen(false);
      setPinned(false);
      setExpanded(false);
      setResult(null);
      setError("");
      setCopied("");
    };
    const outside = (event: PointerEvent) => {
      if (
        popup.current?.contains(event.target as Node) ||
        dot.current?.contains(event.target as Node)
      )
        return;
      hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const scroll = (event: Event) => {
      if (!pinned && !popup.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("pointerup", select);
    document.addEventListener("keyup", select);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerup", select);
      document.removeEventListener("keyup", select);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [settings?.translation.enabled, view, hide, pinned]);

  useEffect(() => {
    if (!open || !selection) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const key = `${provider}\0${target}\0${selection.text}`;
    const saved = cache.current.get(key);
    setError("");
    setResult(saved || null);
    setBusy(!saved);
    if (!saved)
      api<Translation>(
        "/translate",
        { text: selection.text, provider, target },
        controller.signal,
      )
        .then((value) => {
          if (controller.signal.aborted) return;
          if (cache.current.size > 50) cache.current.clear();
          cache.current.set(key, value);
          setResult(value);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    return () => controller.abort();
  }, [open, selection, provider, target]);

  useEffect(
    () => () => {
      clearTimeout(hover.current);
      clearTimeout(close.current);
      request.current?.abort();
    },
    [],
  );
  const keep = () => clearTimeout(close.current);
  const leave = () => {
    clearTimeout(hover.current);
    if (!pinned) close.current = setTimeout(hide, 500);
  };
  const copy = async (text: string, part: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(part);
    } catch {
      setError("复制未完成，请手动选中内容复制");
    }
  };
  if (!selection || !settings?.translation.enabled) return null;
  const top = Math.min(
    selection.y + 24,
    Math.max(12, window.innerHeight - Math.min(470, window.innerHeight * 0.7)),
  );
  const left = Math.max(12, Math.min(selection.x, window.innerWidth - 382));
  return createPortal(
    <>
      <button
        ref={dot}
        className="pa-selection-dot"
        style={{ left: selection.x, top: selection.y }}
        aria-label="翻译所选文字"
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onMouseEnter={() => {
          keep();
          clearTimeout(hover.current);
          hover.current = setTimeout(() => setOpen(true), 250);
        }}
        onMouseLeave={leave}
        onFocus={() => setOpen(true)}
        onClick={() => {
          keep();
          setOpen(true);
        }}
      />
      {open && (
        <div
          ref={popup}
          className="pa-translation"
          role="dialog"
          aria-label="划词翻译"
          style={{ left, top }}
          onMouseEnter={keep}
          onMouseLeave={leave}
        >
          <header>
            <MaterialIcon type="translate" />
            <select
              aria-label="翻译服务"
              value={provider}
              onChange={(event) => {
                setCopied("");
                setProvider(event.target.value);
              }}
            >
              {Object.entries(services).map(([key, label]) => (
                <option key={key} value={key}>
                  {key === "llm" &&
                  (settings.bindings.translation.model ||
                    settings.bindings.chat.model)
                    ? `大模型 · ${settings.bindings.translation.model || settings.bindings.chat.model}`
                    : label}
                </option>
              ))}
            </select>
            <span className="flex-grow-1" />
            <button
              aria-label={pinned ? "取消固定译文" : "固定译文"}
              aria-pressed={pinned}
              onClick={() => setPinned(!pinned)}
            >
              <MaterialIcon type="push_pin" />
            </button>
            <button aria-label="关闭翻译" onClick={hide}>
              <MaterialIcon type="close" />
            </button>
          </header>
          <div className="pa-translation-body">
            <section className="pa-translation-block">
              <div className="pa-translation-label">
                原文 ·{" "}
                {result?.source && result.source !== "auto"
                  ? result.source
                  : "自动检测"}
              </div>
              <div
                className={expanded ? undefined : "pa-source-clamped"}
                data-testid="translation-original"
              >
                {selection.text}
              </div>
              <div className="pa-translation-controls">
                <button
                  aria-label="复制原文"
                  onClick={() => copy(selection.text, "source")}
                >
                  <MaterialIcon
                    type={copied === "source" ? "check" : "content_copy"}
                  />
                </button>
                <button onClick={() => setExpanded(!expanded)}>
                  {expanded ? "收起原文" : "展开原文"}{" "}
                  <span aria-hidden>{expanded ? "⌃" : "⌄"}</span>
                </button>
              </div>
            </section>
            <section className="pa-translation-block">
              <div className="pa-translation-label">
                译文 ·{" "}
                <select
                  className="pa-translation-language"
                  aria-label="目标语言"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                </select>
              </div>
              <div className="pa-translated" role="status">
                {busy ? "正在翻译…" : error || result?.translatedText}
              </div>
              {result && !busy && !error && (
                <div className="pa-translation-controls">
                  <button
                    aria-label="复制译文"
                    onClick={() => copy(result.translatedText, "translation")}
                  >
                    <MaterialIcon
                      type={copied === "translation" ? "check" : "content_copy"}
                    />
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
