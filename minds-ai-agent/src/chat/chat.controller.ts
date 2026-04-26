import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto, ChatRequestSchema } from './dto/chat-request.dto';

@ApiTags('chat')
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream a chat response (AI SDK compatible)',
    description: 'Accepts messages and streams a response using the AI SDK UI Message Stream Protocol.',
  })
  @ApiProduces('text/event-stream')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['messages'],
      properties: {
        messages: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['role', 'content'],
            properties: {
              id: { type: 'string' },
              role: { type: 'string', enum: ['user', 'assistant', 'system'] },
              content: {
                oneOf: [
                  { type: 'string', minLength: 1 },
                  { type: 'array', items: { type: 'object', additionalProperties: true } },
                ],
              },
              parts: {
                type: 'array',
                description: 'AI SDK UIMessage parts. Text parts are normalized into message content.',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', example: 'text' },
                    text: { type: 'string', example: 'Hello' },
                  },
                  additionalProperties: true,
                },
              },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        model: { type: 'string', example: 'claude-sonnet-4-6' },
        provider: { type: 'string', enum: ['openai', 'anthropic'] },
        sessionId: { type: 'string' },
        enableUiDiscovery: { type: 'boolean', default: true },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'AI SDK UI message stream (text/event-stream)' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async chat(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid request body', errors: parsed.error.flatten() });
      return;
    }

    const dto: ChatRequestDto = parsed.data;

    if (dto.provider) process.env.AI_PROVIDER = dto.provider;
    if (dto.model) process.env.AI_MODEL = dto.model;

    await this.chatService.stream(dto, res);
  }
}
