# Groq provider: configuration and rollback

## Scope

This change adds Groq without removing the existing OpenAI or Gemini paths.

- Chat responses can use Groq through its OpenAI-compatible endpoint.
- Incoming WhatsApp audio prefers Groq transcription with
  `whisper-large-v3-turbo` when `GROQ_API_KEY` exists.
- Outgoing synthesized audio remains unchanged and continues to use the
  provider selected in the TTS section, normally ElevenLabs.
- Image understanding remains on the existing OpenAI vision fallback.

## Coolify configuration

Add this runtime environment variable to the `ryzapp.org` application:

```text
GROQ_API_KEY=<secret value>
```

Save the variable and perform a full redeploy. Do not put the key in Git or in
this document.

After deployment:

1. Open `/ai-agent` as an administrator.
2. Select `Groq` under `Proveedor de respuesta`.
3. Select `Llama 3.3 70B`.
4. Save the AI configuration.
5. Send a short WhatsApp text and confirm the logs do not contain
   `[AI] Groq failed`.
6. Send a WhatsApp voice note and confirm the audio debug log reports
   `provider: groq` and `model: whisper-large-v3-turbo`.

## Quick operational rollback

This does not require reverting code:

1. Open `/ai-agent`.
2. Select `OpenAI` or `Gemini`.
3. Save the configuration.

The Groq code remains dormant while another provider is selected. Removing
`GROQ_API_KEY` also restores the legacy OpenAI transcription path for incoming
audio.

## Full code rollback

Find the deployment commit:

```powershell
git log --oneline --grep="add Groq provider"
```

Create a safe inverse commit and deploy it:

```powershell
git revert <groq-commit-hash>
git push origin main
```

Do not use `git reset --hard`; the repository may contain unrelated local
files. Reverting the Groq commit restores the previous provider enum, admin
selector, chat request path, and OpenAI-only transcription behavior.
