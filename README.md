# clicky-proxy

Local Clicky-compatible backend proxy powered by OpenAI.

This project is designed to be safe and easy:

- no hardcoded API keys
- env-based configuration
- `.env` is git-ignored by default
- includes helper scripts for start/stop/health/logs

---

## 1) Quick Start (Copy/Paste)

```bash
cd "/Users/umairali/Documents/Projects/clicky-proxy"
cp backend/.env.example backend/.env
```

Open `backend/.env`, then set:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

Start:

```bash
npm run start
```

Health check:

```bash
npm run health
```

Expected result includes `"ok": true`.

---

## 2) Project Structure

- `backend/server.mjs`  
  Main proxy server. Handles:
  - `POST /chat`
  - `POST /tts`
  - `GET /health`
  - compatibility routes (`/credits`, `/usage`, unknown `POST` fallback)

- `backend/.env.example`  
  Template env file for users.

- `scripts/`  
  Helper commands for full Clicky workflow.

- `package.json`  
  Easy npm scripts (`start`, `dev`, `stack`, `health`).

---

## 3) Environment Variables (Important)

Edit `backend/.env`:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | - | OpenAI API key for chat + TTS |
| `OPENAI_CHAT_MODEL` | No | `gpt-5` | Chat model |
| `OPENAI_TTS_MODEL` | No | `gpt-4o-mini-tts` | TTS model |
| `OPENAI_TTS_VOICE` | No | `shimmer` | Voice |
| `CLICKY_CALL_NAME` | No | `pintO` | Assistant call-name |
| `CLICKY_ENABLE_AUTO_CLICK` | No | `1` | Enables click execution from POINT tags |
| `CLICKY_BACKEND_PORT` | No | `8787` | Backend port |
| `CLICKY_LOG_CHAT_TEXT` | No | `1` | Logs readable user/assistant text previews |
| `CLICKY_LOG_TEXT_LIMIT` | No | `320` | Max chars per log preview line |

---

## 4) Model + Voice Selection

### Chat model

Set in `backend/.env`:

```env
OPENAI_CHAT_MODEL=gpt-5
```

Common options:
- `gpt-5` (best quality)
- `gpt-4o` (fast + strong)
- `gpt-4o-mini` (lower cost)

### TTS voice

Set in `backend/.env`:

```env
OPENAI_TTS_VOICE=shimmer
```

Popular realistic female voices:
- `shimmer` (recommended)
- `nova`
- `coral`

---

## 5) How To Run

### A) Backend only (API mode)

```bash
npm run start
```

### B) Full Clicky local stack (if Clicky app bundle is configured in this folder)

```bash
./scripts/run-local-stack.sh
```

---

## 6) Daily Commands

From repo root:

```bash
./scripts/start-backend.sh
./scripts/stop-backend.sh
./scripts/status-backend.sh
./scripts/health-check.sh
./scripts/quick-recover.sh
```

Live text logs (easy to read):

```bash
./scripts/tail-clicky-text.sh
```

---

## 7) Logs

Primary backend log:

- `backend/backend.log`

Shows:

- request paths
- model usage
- text previews:
  - `/chat user="..."`
  - `/chat assistant="..."`
  - `/tts text="..."`

---

## 8) Troubleshooting

### `OPENAI_API_KEY is missing`

Set `OPENAI_API_KEY` in `backend/.env`, then restart backend.

### Health check fails

Run:

```bash
./scripts/quick-recover.sh
```

### Clicky says credits exhausted

- ensure backend is running (`./scripts/status-backend.sh`)
- ensure Clicky endpoints are patched to local
- verify `/health` returns ok

### Clicky hotkey unstable / app crash

For this app build, keep app transcription provider as:

- `VoiceTranscriptionProvider=assemblyai`

Do not force openai transcription in app plist for hotkey flow unless thoroughly tested.

### Auto-click not happening

Grant macOS Accessibility permission to Terminal/osascript.

---

## 9) Security

- Never commit `.env`.
- `.gitignore` already excludes secrets/logs/local artifacts.
- Rotate keys immediately if accidentally exposed.
