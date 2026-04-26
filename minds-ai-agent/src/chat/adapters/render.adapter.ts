import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { SseEventPayload, JsonPatchOperation, DataSpecPayload, UiComponentType } from '../dto/sse-event.dto';

const JSON_PATCH_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

function isJsonPatch(value: unknown): value is JsonPatchOperation[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return (value as Record<string, unknown>[]).every(
    (item) => typeof item === 'object' && item !== null && JSON_PATCH_OPS.has(item['op'] as string),
  );
}

export interface RenderAdapterConfig {
  componentType?: UiComponentType;
  requestId: string;
}

@Injectable()
export class RenderAdapter {
  async processStream(
    tokenStream: AsyncIterable<string>,
    emitter: Subject<SseEventPayload>,
    config: RenderAdapterConfig,
    dataSpec?: DataSpecPayload | null,
  ): Promise<void> {
    const { requestId, componentType } = config;

    emitter.next({ type: 'text-start', data: { componentType: componentType ?? 'text' }, id: requestId });

    const buffer: string[] = [];

    for await (const token of tokenStream) {
      if (!token) continue;
      buffer.push(token);
      emitter.next({ type: 'text-delta', data: { delta: token }, id: requestId });
    }

    const fullText = buffer.join('');

    if (!fullText) {
      if (dataSpec) {
        emitter.next({ type: 'data-spec', data: dataSpec, id: requestId });
      } else {
        emitter.next({ type: 'text-end', data: { text: '[No response generated]', isPatch: false }, id: requestId });
      }
      return;
    }

    let parsed: unknown = null;
    try {
      const trimmed = fullText.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        parsed = JSON.parse(trimmed);
      }
    } catch {
      parsed = null;
    }

    if (isJsonPatch(parsed)) {
      emitter.next({ type: 'text-end', data: { text: fullText, isPatch: true }, id: requestId });
      emitter.next({ type: 'data-spec', data: { componentType: componentType ?? 'json-tree', props: dataSpec?.props ?? {}, patch: parsed }, id: requestId });
      return;
    }

    emitter.next({ type: 'text-end', data: { text: fullText, isPatch: false }, id: requestId });

    if (dataSpec) {
      emitter.next({ type: 'data-spec', data: dataSpec, id: requestId });
    }
  }
}
