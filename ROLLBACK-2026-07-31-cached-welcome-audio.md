# Reversión: audio de bienvenida reutilizable

## Alcance

- Audio guardado: `server/assets/audio/berberina-bienvenida.ogg`
- Detección y envío: `server/routes.ts`
- Solo aplica al primer saludo de Berberina que coincide con las frases configuradas.
- Las demás respuestas continúan utilizando el proveedor TTS configurado.

## Desactivación inmediata sin revertir código

Configurar en Coolify:

```env
CACHED_WELCOME_AUDIO_ENABLED=false
```

Después, redesplegar la aplicación. El primer saludo volverá a generarse mediante ElevenLabs u OpenAI TTS según la configuración activa.

## Reversión completa

Revertir el commit que incorporó esta función. Esto elimina la detección de bienvenida reutilizable y el archivo OGG, sin modificar el prompt ni la configuración general de audio.

## Comportamiento de respaldo

Si el archivo no existe, no puede leerse o Meta rechaza el envío, el CRM intenta automáticamente generar y enviar el audio mediante el proveedor TTS configurado.
