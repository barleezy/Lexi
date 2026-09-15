import {
  CHAT_COMPLETIONS_URL,
  DEFAULT_CHAT_MODEL,
  chatModelFromEnv,
  readChatError,
  readChatText,
} from "./parse";

export {
  CHAT_COMPLETIONS_URL,
  DEFAULT_CHAT_MODEL,
  chatModelFromEnv,
  readChatError,
  readChatText,
} from "./parse";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function buildTextChannelNote(platform: string) {
  return `This turn is a text message on ${platform}, not the voice tab. Reply in short plain text — no stage directions, no audio tags, no reading SESSION ID or PRIOR CHAT aloud. Same you as voice. Do not call tools. Do not ping him again on this same channel unless he asked you to message another app.`;
}

export function buildChannelMessages(input: {
  platform: string;
  userText: string;
  instructions: string;
  prior: Array<{ user_text: string; assistant_text: string }>;
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: `${input.instructions}\n\n${buildTextChannelNote(input.platform)}` },
  ];
  for (const turn of input.prior) {
    const user = turn.user_text.trim();
    const assistant = turn.assistant_text.trim();
    if (user) messages.push({ role: "user", content: user });
    if (assistant) messages.push({ role: "assistant", content: assistant });
  }
  messages.push({ role: "user", content: input.userText });
  return messages;
}
