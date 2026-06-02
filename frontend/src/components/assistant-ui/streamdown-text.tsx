"use client";

import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { memo } from "react";
import { CodeBlockHeader } from "@/components/assistant-ui/code-block";

// Reuse the shared header design (label + copy button) for code blocks in the
// final assistant answer so they match the tool-timeline code blocks.
const CodeHeader = ({ language, code }: { language: string | undefined; code: string }) => (
  <CodeBlockHeader label={language || "text"} code={code} />
);

const StreamdownTextImpl = () => (
  <StreamdownTextPrimitive plugins={{ code, math }} components={{ CodeHeader }} />
);

export const StreamdownText = memo(StreamdownTextImpl);
