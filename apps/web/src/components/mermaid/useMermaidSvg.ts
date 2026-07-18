import mermaid from "mermaid";
import { useEffect, useId, useRef, useState } from "react";

import { getMermaidRenderSources } from "./mermaidViewLogic";

interface UseMermaidSvgOptions {
  readonly enabled?: boolean;
}

interface MermaidSvgState {
  readonly svg: string;
  readonly error: string | null;
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function buildRenderId(prefix: string, counter: number): string {
  return `${prefix.replace(/[^a-zA-Z0-9_-]/g, "")}-${counter}`;
}

export function useMermaidSvg(source: string, options: UseMermaidSvgOptions = {}): MermaidSvgState {
  const enabled = options.enabled ?? true;
  const renderPrefix = useId();
  const renderCounterRef = useRef(0);
  const [state, setState] = useState<MermaidSvgState>({ svg: "", error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ svg: "", error: null });
      return;
    }

    let cancelled = false;
    const render = async () => {
      if (!source.trim()) {
        setState({ svg: "", error: "This Mermaid attachment has no source." });
        return;
      }
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isDarkMode() ? "dark" : "default",
          sequence: { useMaxWidth: false },
          flowchart: { useMaxWidth: false },
        });

        let lastError: unknown = null;
        for (const candidate of getMermaidRenderSources(source)) {
          try {
            const renderId = buildRenderId(renderPrefix, renderCounterRef.current++);
            const result = await mermaid.render(renderId, candidate);
            if (cancelled) return;
            setState({ svg: result.svg, error: null });
            return;
          } catch (cause) {
            lastError = cause;
          }
        }

        throw lastError;
      } catch (cause) {
        if (cancelled) return;
        setState({
          svg: "",
          error: cause instanceof Error ? cause.message : "Failed to render diagram.",
        });
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [enabled, renderPrefix, source]);

  return state;
}
