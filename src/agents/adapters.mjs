export function createAdapter(opt) {
  const READ_ONLY_CLAUDE_TOOLS = [
    'Read',
    'Grep',
    'Glob',
    'Bash(git:*)',
    'Bash(gh:*)',
    'Bash(ls:*)',
    'Bash(wc:*)',
  ]

  const ADAPTERS = {
    claude: ({ prompt }) => ({
      cmd: 'claude',
      args: [
        '-p',
        '--output-format',
        'json',
        '--permission-mode',
        'default',
        '--allowedTools',
        ...READ_ONLY_CLAUDE_TOOLS,
        '--disallowedTools',
        'Edit',
        'Write',
        'NotebookEdit',
        ...(opt.model ? ['--model', opt.model] : []),
      ],
      stdin: prompt,
    }),
    codex: ({ prompt, outFile, schemaFile }) => ({
      cmd: 'codex',
      args: [
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '-o',
        outFile,
        ...(schemaFile ? ['--output-schema', schemaFile] : []),
        ...(opt.model ? ['-m', opt.model] : []),
        '-',
      ],
      stdin: prompt,
      outFile,
    }),
    opencode: ({ promptFile }) => ({
      cmd: 'opencode',
      // Feed stdin directly: file attachments can require interactive access outside the repo.
      // Keep flags before the message for OpenCode v2 compatibility.
      args: [
        'run',
        ...(opt.opencodeStandalone ? ['--standalone'] : []),
        '--agent',
        'plan',
        '--format',
        'json',
        ...(opt.model ? ['-m', opt.model] : []),
        'Follow the instructions provided on standard input exactly. Your final message is the answer.',
      ],
      stdinFile: promptFile,
    }),
    custom: ({ prompt, promptFile, outFile, schemaFile }) => {
      if (!opt.agentCmd) throw new Error('--agent custom requires --agent-cmd')
      return {
        cmd: 'sh',
        args: ['-c', opt.agentCmd],
        stdin: prompt,
        outFile,
        env: {
          KASANOME_PROMPT_FILE: promptFile,
          KASANOME_OUT_FILE: outFile,
          KASANOME_SCHEMA_FILE: schemaFile || '',
        },
      }
    },
  }
  const name = opt.agent || 'claude'
  if (!ADAPTERS[name])
    throw new Error(`Unknown --agent ${name}. Use: ${Object.keys(ADAPTERS).join(', ')}`)
  return ADAPTERS[name]
}
