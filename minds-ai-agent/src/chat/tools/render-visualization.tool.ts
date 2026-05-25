import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { DataSpecPayload, UiComponentType } from '../dto/sse-event.dto';

@Injectable()
export class RenderVisualizationTool {
  asTool() {
    return createTool({
      id: 'render_visualization',
      description: 'Render visualization via the structured renderer adapter.',
      inputSchema: z.object({
        componentType: z.string(),
        props: z.record(z.string(), z.unknown()),
        patch: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
      execute: async (input): Promise<{ rendered: boolean; dataSpec: DataSpecPayload }> => ({
        rendered: true,
        dataSpec: {
          componentType: input.componentType as UiComponentType,
          props: input.props,
          patch: input.patch as DataSpecPayload['patch'],
        },
      }),
    });
  }
}
