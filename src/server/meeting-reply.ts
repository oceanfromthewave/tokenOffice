export function cleanMeetingReply(provider: 'claude' | 'codex', text: string): string {
  if (provider !== 'claude') return text.trim();
  return text
    .replace(/<function_calls?\b[^>]*>[\s\S]*?<\/function_calls?>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    .trim();
}
