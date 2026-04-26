import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';
import type { DataSpecPayload, UiComponentType } from '../dto/sse-event.dto';

@Injectable()
export class RenderVisualizationTool {
  asTool() {
    return tool({
      description:
        'Render visualization via the structured renderer adapter. ' +
        'Produces a data-spec payload compatible with the frontend component system.',
      inputSchema: z.object({
        componentType: z.enum([
          'text',
          'table',
          'chart',
          'weather-card',
          'metric-card',
          'list',
          'json-tree',
        ]),
        props: z.record(z.string(), z.unknown()),
        patch: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
      execute: async ({ componentType, props, patch }): Promise<{
        rendered: boolean;
        dataSpec: DataSpecPayload;
      }> => ({
        rendered: true,
        dataSpec: {
          componentType: componentType as UiComponentType,
          props,
          patch: patch as DataSpecPayload['patch'],
        },
      }),
    });
  }
}
