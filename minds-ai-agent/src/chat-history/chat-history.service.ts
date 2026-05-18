import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SessionRepository, type ListSessionsOptions } from './session.repository';
import { MessageRepository } from './message.repository';
import type { ChatSession, SessionWithMessages, NewMessage } from './chat-history.types';

export interface AppendTurnParams {
  sessionId: string;
  messages: NewMessage[];
  autoTitle?: string;
}

@Injectable()
export class ChatHistoryService {
  constructor(
    @InjectPinoLogger(ChatHistoryService.name) private readonly logger: PinoLogger,
    private readonly sessions: SessionRepository,
    private readonly messages: MessageRepository,
  ) {}

  async createSession(params: { userId?: string; title?: string; metadata?: Record<string, unknown> } = {}): Promise<ChatSession> {
    const session = await this.sessions.create(params);
    this.logger.info({ sessionId: session.id }, 'Chat session created');
    return session;
  }

  async listSessions(opts: ListSessionsOptions = {}): Promise<ChatSession[]> {
    return this.sessions.list(opts);
  }

  async getSession(id: string): Promise<SessionWithMessages> {
    const session = await this.sessions.findWithMessages(id);
    if (!session) throw new NotFoundException(`Chat session ${id} not found`);
    return session;
  }

  async updateSession(id: string, patch: { title?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const exists = await this.sessions.findById(id);
    if (!exists) throw new NotFoundException(`Chat session ${id} not found`);
    await this.sessions.update(id, patch);
  }

  async archiveSession(id: string): Promise<void> {
    const exists = await this.sessions.findById(id);
    if (!exists) throw new NotFoundException(`Chat session ${id} not found`);
    await this.sessions.archive(id);
    this.logger.info({ sessionId: id }, 'Chat session archived');
  }

  async appendTurn(params: AppendTurnParams): Promise<void> {
    const { sessionId, messages, autoTitle } = params;

    const session = await this.sessions.findById(sessionId);
    if (!session) throw new NotFoundException(`Chat session ${sessionId} not found`);

    await this.messages.insertMany(sessionId, messages);
    await this.sessions.touchUpdatedAt(sessionId);

    if (autoTitle && session.title === 'New Chat') {
      await this.sessions.update(sessionId, { title: autoTitle.slice(0, 500) });
    }

    this.logger.info({ sessionId, messageCount: messages.length }, 'Chat turn appended');
  }

  async ensureSession(sessionId: string | undefined, userId?: string): Promise<string> {
    if (sessionId) {
      const exists = await this.sessions.findById(sessionId);
      if (exists) return sessionId;
    }
    const session = await this.sessions.create({ userId });
    return session.id;
  }
}
