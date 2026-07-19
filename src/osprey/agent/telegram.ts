// The live channel. In production this repo receives updates via webhook
// (see src/app/api/telegram/route.ts) instead of long-polling — no
// always-on process to host. Long-polling (`npm run telegram` in
// ../osprey-agent) remains the local dev mode; this vendored copy keeps only
// what the webhook path needs.
//
// Chat binding: each investor profile gains a `telegramChatId`, bound when
// the user opens t.me/<bot>?start=<userId> (Telegram sends
// "/start <userId>"), where <userId> is the Osprey account id
// (investor_profiles.user_id === profile.id). A profile already bound to
// another chat refuses to rebind.

import type { Store } from './store';
import { respond } from './messenger/respond';
import type { IntentParser } from './messenger/intents';

const API = 'https://api.telegram.org';
/** Telegram caps messages at 4096 chars; stay under it with headroom. */
const CHUNK = 4000;

/** One-tap verdict replies; callback data feeds the keyword fast-path. */
const VERDICT_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🔍 Analyze', callback_data: 'A' },
      { text: '👎 Pass', callback_data: 'P' },
      { text: '⭐ Save', callback_data: 'S' },
    ],
  ],
};

export interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from?: { first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id?: number; chat: { id: number } };
  };
}

export interface SendOptions {
  verdictButtons?: boolean;
}

export class TelegramClient {
  constructor(private token: string) {}

  private async call<T>(method: string, payload?: object): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!body.ok) throw new Error(`Telegram ${method} failed: ${body.description ?? res.status}`);
    return body.result as T;
  }

  getMe(): Promise<{ username?: string; first_name?: string }> {
    return this.call('getMe');
  }

  /** Returns the message_id of the last chunk sent — the one carrying the buttons. */
  async sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<number | undefined> {
    const chunks = chunkText(text, CHUNK);
    let lastId: number | undefined;
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1;
      const sent = await this.call<{ message_id?: number }>('sendMessage', {
        chat_id: chatId,
        text: chunks[i],
        ...(last && opts?.verdictButtons ? { reply_markup: VERDICT_KEYBOARD } : {}),
      });
      lastId = sent.message_id;
    }
    return lastId;
  }

  answerCallbackQuery(id: string): Promise<unknown> {
    return this.call('answerCallbackQuery', { callback_query_id: id });
  }
}

export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    // Prefer breaking on a newline so verdict lines stay intact.
    const slice = rest.slice(0, max);
    const cut = slice.lastIndexOf('\n');
    const at = cut > max / 2 ? cut : max;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export interface TelegramDeps {
  store: Store;
  parser: IntentParser | null;
  send: (chatId: number, text: string, opts?: SendOptions) => Promise<void>;
  answerCallback?: (id: string) => Promise<unknown>;
  log?: (line: string) => void;
}

/** Route one Telegram update: bind on /start, otherwise respond() and reply. */
export async function handleUpdate(update: TgUpdate, deps: TelegramDeps): Promise<void> {
  let chatId: number | undefined;
  let text: string | undefined;
  let dealHint: string | undefined;

  if (update.callback_query) {
    chatId = update.callback_query.message?.chat.id;
    text = update.callback_query.data;
    // Buttons live on a specific verdict card — resolve to that card's deal,
    // never to whichever verdict happens to be newest.
    const messageId = update.callback_query.message?.message_id;
    if (chatId != null && messageId != null) {
      dealHint = (await deps.store.loadTgAnchor(chatId, messageId)) ?? undefined;
    }
    await deps.answerCallback?.(update.callback_query.id);
  } else if (update.message?.text) {
    chatId = update.message.chat.id;
    text = update.message.text;
  }
  if (chatId == null || !text) return;

  const start = /^\/start(?:\s+(\S+))?\s*$/.exec(text);
  if (start) {
    await handleStart(chatId, start[1] ?? null, deps);
    return;
  }

  const profile = await deps.store.findProfileByChatId(chatId);
  if (!profile) {
    await deps.send(
      chatId,
      "This chat isn't linked to an Osprey account yet. Open your personal invite link from your Osprey dashboard at getosprey.ai.",
    );
    return;
  }

  const result = await respond(
    profile.id,
    text,
    { store: deps.store, parser: deps.parser, log: deps.log },
    { dealHint },
  );
  if (result.reply !== null) await deps.send(chatId, result.reply);
}

async function handleStart(
  chatId: number,
  payload: string | null,
  deps: TelegramDeps,
): Promise<void> {
  const bound = await deps.store.findProfileByChatId(chatId);
  if (bound) {
    await deps.send(chatId, `Already linked as ${bound.name}. Send HELP for what I understand.`);
    return;
  }

  // Bare /start (or an unrecognized payload) is ambiguous across a
  // multi-tenant bot — there's no single unbound profile to guess. The user
  // must come from their own dashboard's deep link.
  const target = payload ? await deps.store.loadProfile(payload) : null;

  if (!target) {
    await deps.send(
      chatId,
      'Open your personal invite link from your Osprey dashboard at getosprey.ai so I know which account this is.',
    );
    return;
  }
  if (target.telegramChatId != null && target.telegramChatId !== chatId) {
    await deps.send(
      chatId,
      `${target.name}'s account is already linked to another chat. Contact support to move it.`,
    );
    return;
  }

  target.telegramChatId = chatId;
  await deps.store.saveProfile(target);
  await deps.send(
    chatId,
    `🪶 Linked, ${target.name}. Osprey will message verdicts here.\n\n` +
      'On any deal: A = full analysis · P = pass (add a reason and I learn your taste) · ' +
      'S = save. Plain English works too — "bump my max to 450k". HELP anytime.',
  );
}
