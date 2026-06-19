// Strip <system-reminder>…</system-reminder> blocks from assistant prose.
//
// The verifier (L1) injects reminders as <system-reminder>…</system-reminder>
// user messages. The model is told to read them but not to echo them.
// Trust-but-verify: defense in depth so a chatty model can't leak the
// reminder content into the user-visible response.

const REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>\s*/gi
const OPEN_ONLY = /<system-reminder>[\s\S]*$/i

export function stripSystemReminders(text: string): string {
  if (!text) return text
  let out = text.replace(REMINDER_PATTERN, '')
  // If the model started a reminder block but never closed it, drop the
  // trailing fragment too — better to show nothing than half of the prompt.
  out = out.replace(OPEN_ONLY, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
