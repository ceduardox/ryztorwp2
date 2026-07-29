# Admin-only AI audio reply: configuration and rollback

## Scope

This change adds an admin-only button to recover a conversation whose latest
message is inbound and still has no outbound reply.

- The client only renders the button for `role === "admin"`.
- The server endpoint is also protected by `requireAdmin`.
- The AI provider is not hardcoded. It uses the provider currently saved in
  `/ai-agent` (OpenAI, Groq, or Gemini).
- The synthesized voice uses the existing TTS configuration, normally
  ElevenLabs.
- The server checks the latest message before and after AI generation. If the
  conversation changed, it returns HTTP 409 and sends nothing.
- The manual admin action intentionally bypasses the automatic audio text
  guards, but it does not bypass provider or WhatsApp failures.

## Endpoint

```text
POST /api/conversations/:id/ai-audio-reply
```

Payload:

```json
{
  "lastInboundMessageId": 123
}
```

## Operational rollback

No database migration is involved. To stop using the feature immediately,
administrators can simply avoid the purple audio button.

## Full code rollback

Find the feature commit:

```powershell
git log --oneline --grep="admin-only AI audio reply"
```

Create and deploy an inverse commit:

```powershell
git revert <feature-commit-hash>
git push origin main
```

Do not use `git reset --hard`; unrelated local files may exist in the checkout.
