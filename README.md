# pipecat-quickstart

A Pipecat AI voice agent built with a cascade pipeline (STT → LLM → TTS).

## Configuration

- **Bot Type**: Web
- **Transport(s)**: SmallWebRTC, Daily (WebRTC)
- **Pipeline**: Cascade
  - **STT**: Deepgram
   - **LLM**: OpenRouter
  - **TTS**: Cartesia

## Setup

### Server

1. **Navigate to server directory**:

   ```bash
   cd server
   ```

2. **Install dependencies**:

   ```bash
   uv sync
   ```

3. **Configure environment variables**:

   Add the OpenRouter, Deepgram, and Cartesia credentials to `server/.env` before
   starting the bot. The browser client opens directly to the voice app.

4. **Run the bot**:

   ```bash
   uv run bot.py
   ```

   The runner serves every transport; the caller selects which one (a web/mobile
   client picks its transport when it connects; a telephony provider connects to
   `/ws`).

## Project Structure

```
pipecat-quickstart/
├── server/              # Python bot server
│   ├── bot.py           # Main bot implementation
│   ├── pyproject.toml   # Python dependencies
│   ├── .env.example     # Environment variables template
│   ├── .env             # Your API keys (git-ignored)
│   ├── Dockerfile       # Container image for Pipecat Cloud
│   └── pcc-deploy.toml  # Pipecat Cloud deployment config
├── .gitignore           # Git ignore patterns
└── README.md            # This file
```

## Deploying to Pipecat Cloud

This project is configured for deployment to Pipecat Cloud. You can learn how to deploy to Pipecat Cloud in the [Pipecat Quickstart Guide](https://docs.pipecat.ai/getting-started/quickstart#step-2-deploy-to-production).

### Connecting the Vercel frontend

The browser client uses `http://localhost:7860/api/offer` for local development.
For a Vercel deployment, add these environment variables in the Vercel project
settings and redeploy:

```text
VITE_PCC_API_URL=https://api.pipecat.daily.co/v1/public
VITE_PCC_AGENT_NAME=pipecat-quickstart
VITE_PCC_PUBLIC_KEY=pk_...
```

The public key is intended for browser session startup. Provider API keys stay
in the Pipecat Cloud server environment and are never added to Vercel.

Refer to the [Pipecat Cloud Documentation](https://docs.pipecat.ai/deployment/pipecat-cloud/introduction) to learn more about configuring, deploying, and managing your agents in Pipecat Cloud.

## Motion Falcon Knowledge

The Vercel deployment keeps Motion Falcon's assistant content private in its serverless
function bundle:

- `api/knowledge/motion-falcon-policy.md`
- `api/knowledge/motion-falcon-public-knowledge.md`

The Vercel endpoint at `/api/motion-falcon-knowledge` requires a bearer token. Configure
the same high-entropy value as `MOTION_FALCON_KNOWLEDGE_TOKEN` in the Vercel project and
as a server-only value in `server/.env` for local use and the Pipecat Cloud secret set for
production:

```text
MOTION_FALCON_KNOWLEDGE_URL=https://your-vercel-domain/api/motion-falcon-knowledge
MOTION_FALCON_KNOWLEDGE_TOKEN=replace-with-a-shared-high-entropy-secret
```

The browser never receives this token or the Markdown documents. The bot downloads the
combined content once when it starts and keeps it in memory for the session. Deploy Vercel,
then restart or redeploy the bot after changing either document. Never put private strategy,
credentials, or client data in `client/public`.

## Building with an AI coding agent

Extending this bot with Claude Code, Codex, or another AI coding assistant? Give it live, accurate Pipecat context instead of stale training data with the **Pipecat Context Hub** — a local index of Pipecat docs, examples, and API source your agent queries over MCP:

```bash
# The Context Hub ships with the CLI
uv tool install "pipecat-ai[cli]"
pipecat context-hub install
```

`install` registers the MCP server with each coding agent it finds and builds the index — a few minutes and about 900 MB the first time. MCP servers load at session start, so do this before opening your coding session, and note the server won't start against an empty index. See the [Pipecat Context Hub docs](https://docs.pipecat.ai/api-reference/context-hub) for the full setup.

## Learn More

- [Pipecat Documentation](https://docs.pipecat.ai/)
- [Pipecat GitHub](https://github.com/pipecat-ai/pipecat)
- [Pipecat Examples](https://github.com/pipecat-ai/pipecat-examples)
- [Discord Community](https://discord.gg/pipecat)