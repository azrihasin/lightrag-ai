import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { streamText, createUIMessageStream, pipeUIMessageStreamToResponse, stepCountIs } from 'ai';
import { ToolRegistry } from '../tools/tool-registry';
import { ModelProvider } from '../providers/model.provider';
import { UiDiscoveryService } from '../discovery/ui-discovery.service';
import { MessageDto } from '../dto/chat-request.dto';

const SYSTEM_PROMPT = `You are a helpful data-gathering assistant. Follow this pipeline:
1. retrieve_context — always start here
2. If context is sufficient: answer_from_context and stop
3. If ambiguous: clarification_request and stop
4. Data query: generate_sql → validate_sql → execute_sql
5. Calculation/search: generate_action → validate_action → execute_system_action
6. After execution: inspect_result
7. If visualization makes sense: prepare_visualization_data → render_visualization
8. Otherwise: summarize_result
9. compose_final_response`;

@Injectable()
export class StrategyAgent {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly modelProvider: ModelProvider,
    private readonly uiDiscovery: UiDiscoveryService,
  ) {}

  run(messages: MessageDto[], enableUiDiscovery: boolean, res: Response): void {
    const model = this.modelProvider.getModel();
    const tools = this.toolRegistry.getAll();

    // Capture writer reference so onStepFinish can inject UI discovery annotations
    let uiWriter: { write: (part: unknown) => void } | null = null;

    const result = streamText({
      model,
      messages,
      tools,
      stopWhen: stepCountIs(5),
      system: SYSTEM_PROMPT,
      onStepFinish: ({ toolResults }) => {
        if (!uiWriter || !enableUiDiscovery || !toolResults?.length) return;
        for (const tr of toolResults as Array<{ toolCallId: string; toolName: string; output?: unknown }>) {
          const raw = tr.output;
          const toolResult = {
            toolName: tr.toolName,
            toolCallId: tr.toolCallId,
            output: this.toolRegistry.sanitize(raw),
            sanitized: true,
            durationMs: 0,
          };
          const discovery = this.uiDiscovery.inspect(toolResult);
          if (discovery) {
            const dataSpec = this.uiDiscovery.buildDataSpec(discovery);
            uiWriter.write({ type: 'data-spec', data: { componentType: dataSpec.componentType, props: dataSpec.props } });
          }
        }
      },
    });

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        uiWriter = writer;
        writer.merge(result.toUIMessageStream());
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream });
  }
}
