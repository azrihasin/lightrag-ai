import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto, ChatRequestSchema } from './dto/chat-request.dto';

@ApiTags('chat')
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ── Streaming chat ─────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream a chat response via the analytics agent (AI SDK compatible)',
    description: 'Routes to the analytics agent, which decides whether to invoke the text-to-viz workflow as a tool.',
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
        id: { type: 'string', description: 'Mastra threadId (AssistantUI thread ID)' },
        sessionId: { type: 'string', description: 'Alias for id (backward compat)' },
        resourceId: { type: 'string', description: 'Mastra resourceId — identifies the user' },
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

  @Post('analytics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream a text-to-visualization response (analytics page)',
    description: 'Bypasses the agent and runs the text-to-viz workflow directly. Use from the analytics query page.',
  })
  @ApiProduces('text/event-stream')
  @ApiResponse({ status: 200, description: 'AI SDK UI message stream with SQL table and visualization spec' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async analyticsChat(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid request body', errors: parsed.error.flatten() });
      return;
    }

    const dto: ChatRequestDto = parsed.data;
    if (dto.provider) process.env.AI_PROVIDER = dto.provider;
    if (dto.model) process.env.AI_MODEL = dto.model;

    await this.chatService.analyticsStream(dto, res);
  }

  // ── Thread history ─────────────────────────────────────────────────────────

  @Get('threads')
  @ApiOperation({ summary: 'List Mastra threads for a resource (user)' })
  @ApiQuery({ name: 'resourceId', required: true, description: 'User/resource identifier' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Thread list' })
  @ApiResponse({ status: 400, description: 'resourceId is required' })
  async listThreads(
    @Query('resourceId') resourceId?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!resourceId) throw new BadRequestException('resourceId query parameter is required');
    const limit = limitStr ? Math.min(Number(limitStr), 200) : 50;
    return this.chatService.listThreads(resourceId, limit);
  }

  @Post('rerun')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-execute the SQL of a persisted assistant message',
    description:
      'Persisted turns store only the SQL + visualization structure (never row data). ' +
      'This re-runs the query server-side and returns fresh rows + a re-hydrated visualization spec.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['threadId', 'messageId', 'resourceId'],
      properties: {
        threadId: { type: 'string' },
        messageId: { type: 'string' },
        resourceId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Fresh columns, rows, rowCount and visualization spec' })
  @ApiResponse({ status: 400, description: 'Missing fields or message has no SQL' })
  @ApiResponse({ status: 404, description: 'Message not found in thread' })
  async rerun(@Body() body: { threadId?: string; messageId?: string; resourceId?: string }) {
    const { threadId, messageId, resourceId } = body ?? {};
    if (!threadId || !messageId || !resourceId) {
      throw new BadRequestException('threadId, messageId and resourceId are required');
    }
    return this.chatService.rerunMessage(threadId, messageId, resourceId);
  }

  @Get('threads/:threadId/messages')
  @ApiOperation({ summary: 'Get all messages for a Mastra thread' })
  @ApiQuery({ name: 'resourceId', required: true })
  @ApiResponse({ status: 200, description: 'Messages for the thread' })
  @ApiResponse({ status: 404, description: 'Thread not found or does not belong to this resource' })
  async getThreadMessages(
    @Param('threadId') threadId: string,
    @Query('resourceId') resourceId?: string,
  ) {
    if (!resourceId) throw new BadRequestException('resourceId query parameter is required');
    const messages = await this.chatService.getThreadMessages(threadId, resourceId);
    if (messages === null) throw new NotFoundException(`Thread ${threadId} not found for this resource`);
    return messages;
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Hard-delete a Mastra thread and all its messages',
    description: 'Permanently removes the thread and its persisted messages. This cannot be undone.',
  })
  @ApiQuery({ name: 'resourceId', required: true })
  @ApiResponse({ status: 204, description: 'Thread deleted' })
  @ApiResponse({ status: 400, description: 'resourceId is required' })
  @ApiResponse({ status: 404, description: 'Thread not found or does not belong to this resource' })
  async deleteThread(
    @Param('threadId') threadId: string,
    @Query('resourceId') resourceId?: string,
  ): Promise<void> {
    if (!resourceId) throw new BadRequestException('resourceId query parameter is required');
    const deleted = await this.chatService.deleteThread(threadId, resourceId);
    if (!deleted) throw new NotFoundException(`Thread ${threadId} not found for this resource`);
  }
}
