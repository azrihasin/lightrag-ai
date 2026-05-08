import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DataSpecPayload, UiComponentType } from '../dto/sse-event.dto';

@Injectable()
export class RenderVisualizationTool {
  asTool() {
    return tool(
      async ({ componentType, props, patch }): Promise<{ rendered: boolean; dataSpec: DataSpecPayload }> => ({
        rendered: true,
        dataSpec: {
          componentType: componentType as UiComponentType,
          props,
          patch: patch as DataSpecPayload['patch'],
        },
      }),
      {
        name: 'render_visualization',
        description:
          'Render visualization via the structured renderer adapter. ' +
          'Produces a data-spec payload compatible with the frontend component system.',
        schema: z.object({
          componentType: z.string().describe('Component name from the json-render catalog'),
          props: z.record(z.string(), z.unknown()),
          patch: z.array(z.record(z.string(), z.unknown())).optional(),
        }),
      },
    );
  }
}
