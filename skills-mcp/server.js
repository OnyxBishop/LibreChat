import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const PORT = parseInt(process.env.PORT || '8790', 10);
const SKILLS_DIR = process.env.SKILLS_DIR || '/app/skills';
const TOKEN = process.env.SKILLS_MCP_TOKEN || '';
const EXEC_TIMEOUT_MS = parseInt(process.env.SKILLS_EXEC_TIMEOUT_MS || '60000', 10);
/** Max bytes captured per output stream. */
const MAX_OUTPUT = 1024 * 1024;
/** Skill directories are keyed by the Mongo ObjectId of their owner / the skill. */
const ID_RE = /^[a-f0-9]{24}$/i;

/** Interpreter selected by the script's file extension. */
const RUNTIMES = {
  '.py': 'python3',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.sh': 'bash',
  '.bash': 'bash',
};

/** Extracts the `name:` field from a SKILL.md YAML frontmatter block. */
function parseFrontmatterName(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) {
    return '';
  }
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) {
      continue;
    }
    if (line.slice(0, i).trim() === 'name') {
      return line
        .slice(i + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
  return '';
}

/**
 * Resolves a user's skill directory by matching the requested name against each
 * bundle's SKILL.md frontmatter `name`. No DB access — the filesystem is authoritative.
 */
async function resolveSkillDir(userId, name) {
  if (!ID_RE.test(String(userId || ''))) {
    return null;
  }
  const wanted = String(name || '')
    .trim()
    .toLowerCase();
  if (!wanted) {
    return null;
  }
  const userDir = path.join(SKILLS_DIR, userId);
  let entries;
  try {
    entries = await fs.promises.readdir(userDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(userDir, entry.name);
    try {
      const md = await fs.promises.readFile(path.join(dir, 'SKILL.md'), 'utf8');
      if (parseFrontmatterName(md).trim().toLowerCase() === wanted) {
        return dir;
      }
    } catch {
      /* ignore unreadable bundle */
    }
  }
  return null;
}

/** Resolves a script path inside a skill dir, rejecting traversal/absolute paths. */
function safeScriptPath(dir, script) {
  const rel = String(script || '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/')) {
    return null;
  }
  const full = path.resolve(dir, rel);
  const diff = path.relative(dir, full);
  if (diff.startsWith('..') || path.isAbsolute(diff)) {
    return null;
  }
  return full;
}

/** Copies the bundle to an ephemeral writable workdir and executes the script. */
async function runSkillScript({ userId, name, script, args, stdin }) {
  const dir = await resolveSkillDir(userId, name);
  if (!dir) {
    return { error: `Skill "${name}" not found for this user.` };
  }
  const scriptFull = safeScriptPath(dir, script);
  if (!scriptFull || !fs.existsSync(scriptFull)) {
    return { error: `Script "${script}" not found in skill "${name}".` };
  }
  const ext = path.extname(scriptFull).toLowerCase();
  const runtime = RUNTIMES[ext] || 'bash';

  const work = path.join(os.tmpdir(), `skill-${crypto.randomUUID()}`);
  await fs.promises.cp(dir, work, { recursive: true });
  const workScript = path.join(work, path.relative(dir, scriptFull));
  const argv = Array.isArray(args) ? args.map(String) : [];
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME || '/home/skilluser',
    LANG: 'C.UTF-8',
    SKILL_NAME: String(name),
  };

  return await new Promise((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    const cap = (acc, chunk) => (acc.length < MAX_OUTPUT ? acc + chunk.toString() : acc);

    let child;
    try {
      child = spawn(runtime, [workScript, ...argv], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      resolve({ error: `Failed to start runtime: ${e.message}` });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, EXEC_TIMEOUT_MS);

    child.stdout.on('data', (c) => (out = cap(out, c)));
    child.stderr.on('data', (c) => (err = cap(err, c)));
    child.on('error', (e) => {
      clearTimeout(timer);
      fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      resolve({ error: `Failed to start runtime: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      resolve({
        exit_code: code,
        timed_out: timedOut,
        stdout: out.slice(0, MAX_OUTPUT),
        stderr: err.slice(0, MAX_OUTPUT),
      });
    });

    if (typeof stdin === 'string' && stdin.length) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/** Builds a fresh stateless MCP server scoped to one user (from the X-User-Id header). */
function buildServer(userId) {
  const server = new McpServer({ name: 'skills', version: '1.0.0' });
  server.registerTool(
    'run_skill_script',
    {
      title: 'Run skill script',
      description:
        "Execute a script bundled with one of the user's skills in an isolated sandbox and return its output (stdout/stderr/exit_code). Use the skill name (as listed under '# Available Skills') and the script's relative path (from load_skill's file listing).",
      inputSchema: {
        name: z.string().describe('The exact skill name.'),
        script: z
          .string()
          .describe('Relative path of the script within the skill bundle, e.g. "fetch.sh".'),
        args: z.array(z.string()).optional().describe('Command-line arguments passed to the script.'),
        stdin: z.string().optional().describe('Optional text piped to the script via stdin.'),
      },
    },
    async ({ name, script, args, stdin }) => {
      if (!userId) {
        return {
          content: [{ type: 'text', text: 'Missing user context; cannot run skill.' }],
          isError: true,
        };
      }
      const result = await runSkillScript({ userId, name, script, args, stdin });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !!result.error,
      };
    },
  );
  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/mcp', async (req, res) => {
  if (TOKEN) {
    const auth = (req.headers['authorization'] || '').toString();
    if (auth !== `Bearer ${TOKEN}`) {
      res
        .status(401)
        .json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
      return;
    }
  }
  const userId = (req.headers['x-user-id'] || '').toString();
  const server = buildServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res
        .status(500)
        .json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
});

/** Stateless transport: no GET SSE stream / DELETE session. */
const methodNotAllowed = (_req, res) =>
  res
    .status(405)
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(PORT, () => {
  if (!TOKEN) {
    console.warn('[skills-mcp] WARNING: SKILLS_MCP_TOKEN not set — auth disabled');
  }
  console.log(`[skills-mcp] listening on :${PORT}, skills dir: ${SKILLS_DIR}`);
});
