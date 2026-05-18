import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ChatHistoryService } from './chat-history.service';
import { CreateSessionSchema } from './dto/create-session.dto';
import { UpdateSessionSchema } from './dto/update-session.dto';
import { AppendMessagesSchema } from './dto/append-messages.dto';

@ApiTags('chat-history')
@Controller('api/chat-history')
export class ChatHistoryController {
  constructor(private readonly chatHistoryService: ChatHistoryService) {}

  // ── Sessions ────────────────────────────────────────────────────────────

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new chat session' })
  @ApiResponse({ status: 201, description: 'Session created' })
  async createSession(@Body() body: unknown) {
    const parsed = CreateSessionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.chatHistoryService.createSession({
      userId: parsed.data.user_id,
      title: parsed.data.title,
      metadata: parsed.data.metadata,
    });
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List chat sessions' })
  @ApiQuery({ name: 'user_id', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'include_archived', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Session list' })
  async listSessions(
    @Query('user_id') userId?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('include_archived') includeArchivedStr?: string,
  ) {
    const limit = limitStr ? Math.min(Number(limitStr), 200) : 50;
    const offset = offsetStr ? Number(offsetStr) : 0;
    const includeArchived = includeArchivedStr === 'true';
    return this.chatHistoryService.listSessions({ userId, limit, offset, includeArchived });
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Load a session with all ordered messages' })
  @ApiResponse({ status: 200, description: 'Session with messages' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getSession(@Param('id') id: string) {
    return this.chatHistoryService.getSession(id);
  }

  @Patch('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update session title or metadata' })
  @ApiResponse({ status: 204, description: 'Updated' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async updateSession(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateSessionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      await this.chatHistoryService.updateSession(id, parsed.data);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw err;
    }
  }

  @Post('sessions/:id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a chat session' })
  @ApiResponse({ status: 204, description: 'Archived' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async archiveSession(@Param('id') id: string) {
    await this.chatHistoryService.archiveSession(id);
  }

  // ── Messages ────────────────────────────────────────────────────────────

  @Post('sessions/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Append messages to a session (transactional)' })
  @ApiResponse({ status: 201, description: 'Messages appended' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async appendMessages(@Param('id') id: string, @Body() body: unknown) {
    const parsed = AppendMessagesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.chatHistoryService.appendTurn({
      sessionId: id,
      messages: parsed.data.messages,
      autoTitle: parsed.data.auto_title,
    });
    return { ok: true };
  }
}
