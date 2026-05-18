import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatHistoryController } from './chat-history.controller';
import { ChatHistoryService } from './chat-history.service';
import type { ChatSession, SessionWithMessages } from './chat-history.types';

const SESSION: ChatSession = {
  id: 'sess-1',
  user_id: null,
  title: 'New Chat',
  created_at: new Date(),
  updated_at: new Date(),
  archived_at: null,
  metadata: null,
};

const SESSION_WITH_MESSAGES: SessionWithMessages = { ...SESSION, messages: [] };

function makeService() {
  return {
    createSession: jest.fn().mockResolvedValue(SESSION),
    listSessions: jest.fn().mockResolvedValue([SESSION]),
    getSession: jest.fn().mockResolvedValue(SESSION_WITH_MESSAGES),
    updateSession: jest.fn().mockResolvedValue(undefined),
    archiveSession: jest.fn().mockResolvedValue(undefined),
    appendTurn: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ChatHistoryController', () => {
  let controller: ChatHistoryController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    service = makeService();
    const mod = await Test.createTestingModule({
      controllers: [ChatHistoryController],
      providers: [{ provide: ChatHistoryService, useValue: service }],
    }).compile();
    controller = mod.get(ChatHistoryController);
  });

  // ── POST /sessions ────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('calls service.createSession and returns the session', async () => {
      const result = await controller.createSession({ title: 'My Chat' });
      expect(service.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Chat' }),
      );
      expect(result.id).toBe('sess-1');
    });

    it('throws BadRequestException for invalid body', async () => {
      await expect(controller.createSession({ title: 123 as any })).rejects.toThrow(BadRequestException);
    });
  });

  // ── GET /sessions ─────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('forwards parsed query params to the service', async () => {
      await controller.listSessions('u1', '10', '5', 'false');
      expect(service.listSessions).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', limit: 10, offset: 5, includeArchived: false }),
      );
    });

    it('caps limit at 200', async () => {
      await controller.listSessions(undefined, '999', undefined, undefined);
      expect(service.listSessions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200 }),
      );
    });
  });

  // ── GET /sessions/:id ─────────────────────────────────────────────────────

  describe('getSession', () => {
    it('returns session with messages', async () => {
      const result = await controller.getSession('sess-1');
      expect(service.getSession).toHaveBeenCalledWith('sess-1');
      expect(result.id).toBe('sess-1');
    });

    it('propagates NotFoundException from service', async () => {
      service.getSession.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.getSession('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── PATCH /sessions/:id ───────────────────────────────────────────────────

  describe('updateSession', () => {
    it('calls service.updateSession with parsed patch', async () => {
      await controller.updateSession('sess-1', { title: 'Renamed' });
      expect(service.updateSession).toHaveBeenCalledWith('sess-1', { title: 'Renamed' });
    });

    it('throws BadRequestException when body has no updatable fields', async () => {
      await expect(controller.updateSession('sess-1', {})).rejects.toThrow(BadRequestException);
    });
  });

  // ── POST /sessions/:id/archive ────────────────────────────────────────────

  describe('archiveSession', () => {
    it('calls service.archiveSession', async () => {
      await controller.archiveSession('sess-1');
      expect(service.archiveSession).toHaveBeenCalledWith('sess-1');
    });
  });

  // ── POST /sessions/:id/messages ───────────────────────────────────────────

  describe('appendMessages', () => {
    it('calls appendTurn with validated messages', async () => {
      const body = {
        messages: [
          { sequence_index: 0, role: 'user', message_type: 'text', content: 'Hello there' },
          { sequence_index: 1, role: 'assistant', message_type: 'text', content: 'Hi' },
        ],
        auto_title: 'Hello there',
      };
      const result = await controller.appendMessages('sess-1', body);
      expect(service.appendTurn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', autoTitle: 'Hello there' }),
      );
      expect(result).toEqual({ ok: true });
    });

    it('throws BadRequestException for invalid message role', async () => {
      const body = {
        messages: [{ sequence_index: 0, role: 'invalid-role', content: 'x' }],
      };
      await expect(controller.appendMessages('sess-1', body)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty messages array', async () => {
      await expect(controller.appendMessages('sess-1', { messages: [] })).rejects.toThrow(BadRequestException);
    });
  });
});
