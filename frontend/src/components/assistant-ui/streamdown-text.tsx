"use client";

import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { memo } from "react";

const StreamdownTextImpl = () => (
  <StreamdownTextPrimitive plugins={{ code, math }} />
);

export const StreamdownText = memo(StreamdownTextImpl);
