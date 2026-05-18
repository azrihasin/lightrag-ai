import { NotFoundException } from '@nestjs/common';
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

const SESSION_WITH_MESSAGES: SessionWithMessages = {
  ...SESSION,
  messages: [
    {
      id: 'msg-1',
      session_id: 'sess-1',
      parent_message_id: null,
      sequence_index: 0,
      role: 'user',
      message_type: 'text',
      content: 'Hello',
      metadata: null,
      tool_payload: null,
      thinking_payload: null,
      model_name: null,
      input_tokens: null,
      output_tokens: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ],
};

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeSessionRepo() {
  return {
    create: jest.fn().mockResolvedValue(SESSION),
    list: jest.fn().mockResolvedValue([SESSION]),
    findById: jest.fn().mockResolvedValue(SESSION),
    findWithMessages: jest.fn().mockResolvedValue(SESSION_WITH_MESSAGES),
    update: jest.fn().mockResolvedValue(undefined),
    archive: jest.fn().mockResolvedValue(undefined),
    touchUpdatedAt: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMessageRepo() {
  return {
    insertMany: jest.fn().mockResolvedValue(undefined),
    countForSession: jest.fn().mockResolvedValue(0),
  };
}

describe('ChatHistoryService', () => {
  let service: ChatHistoryService;
  let sessions: ReturnType<typeof makeSessionRepo>;
  let messages: ReturnType<typeof makeMessageRepo>;

  beforeEach(() => {
    sessions = makeSessionRepo();
    messages = makeMessageRepo();
    service = new ChatHistoryService(makeLogger() as any, sessions as any, messages as any);
  });

  // ── createSession ─────────────────────────────────────────────────────────

  it('createSession delegates to SessionRepository.create', async () => {
    const result = await service.createSession({ userId: 'u1', title: 'Hello' });
    expect(sessions.create).toHaveBeenCalledWith({ userId: 'u1', title: 'Hello', metadata: undefined });
    expect(result.id).toBe('sess-1');
  });

  // ── listSessions ──────────────────────────────────────────────────────────

  it('listSessions forwards options to repository', async () => {
    await service.listSessions({ userId: 'u1', limit: 20 });
    expect(sessions.list).toHaveBeenCalledWith({ userId: 'u1', limit: 20 });
  });

  // ── getSession ────────────────────────────────────────────────────────────

  it('getSession returns session with messages', async () => {
    const result = await service.getSession('sess-1');
    expect(result.messages).toHaveLength(1);
  });

  it('getSession throws NotFoundException when session missing', async () => {
    sessions.findWithMessages.mockResolvedValue(null);
    await expect(service.getSession('missing')).rejects.toThrow(NotFoundException);
  });

  // ── updateSession ─────────────────────────────────────────────────────────

  it('updateSession patches title via repository', async () => {
    await service.updateSession('sess-1', { title: 'Renamed' });
    expect(sessions.update).toHaveBeenCalledWith('sess-1', { title: 'Renamed' });
  });

  it('updateSession throws NotFoundException when session missing', async () => {
    sessions.findById.mockResolvedValue(null);
    await expect(service.updateSession('missing', { title: 'X' })).rejects.toThrow(NotFoundException);
  });

  // ── archiveSession ────────────────────────────────────────────────────────

  it('archiveSession calls repository.archive', async () => {
    await service.archiveSession('sess-1');
    expect(sessions.archive).toHaveBeenCalledWith('sess-1');
  });

  it('archiveSession throws NotFoundException for unknown session', async () => {
    sessions.findById.mockResolvedValue(null);
    await expect(service.archiveSession('missing')).rejects.toThrow(NotFoundException);
  });

  // ── appendTurn ────────────────────────────────────────────────────────────

  it('appendTurn inserts messages and touches updated_at', async () => {
    await service.appendTurn({
      sessionId: 'sess-1',
      messages: [{ sequence_index: 0, role: 'user', content: 'Hi' }],
    });
    expect(messages.insertMany).toHaveBeenCalledWith('sess-1', expect.any(Array));
    expect(sessions.touchUpdatedAt).toHaveBeenCalledWith('sess-1');
  });

  it('appendTurn auto-sets title when session has default title', async () => {
    await service.appendTurn({
      sessionId: 'sess-1',
      messages: [{ sequence_index: 0, role: 'user', content: 'What is 2+2?' }],
      autoTitle: 'What is 2+2?',
    });
    expect(sessions.update).toHaveBeenCalledWith('sess-1', { title: 'What is 2+2?' });
  });

  it('appendTurn does not overwrite a custom title', async () => {
    sessions.findById.mockResolvedValue({ ...SESSION, title: 'Custom Title' });
    await service.appendTurn({
      sessionId: 'sess-1',
      messages: [{ sequence_index: 0, role: 'user', content: 'Hi' }],
      autoTitle: 'Hi',
    });
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it('appendTurn throws NotFoundException for unknown session', async () => {
    sessions.findById.mockResolvedValue(null);
    await expect(
      service.appendTurn({ sessionId: 'bad', messages: [{ sequence_index: 0, role: 'user', content: 'x' }] }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── ensureSession ─────────────────────────────────────────────────────────

  it('ensureSession returns existing session id when found', async () => {
    const id = await service.ensureSession('sess-1');
    expect(id).toBe('sess-1');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('ensureSession creates a new session when id is undefined', async () => {
    const id = await service.ensureSession(undefined);
    expect(sessions.create).toHaveBeenCalled();
    expect(id).toBe('sess-1');
  });

  it('ensureSession creates a new session when given id does not exist', async () => {
    sessions.findById.mockResolvedValue(null);
    const id = await service.ensureSession('unknown-id');
    expect(sessions.create).toHaveBeenCalled();
    expect(id).toBe('sess-1');
  });
});
