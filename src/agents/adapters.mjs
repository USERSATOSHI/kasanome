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
        'text',
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
      // "plan" is opencode's built-in read-only agent. Prompt is attached as a file to avoid argv limits.
      cmd: 'opencode',
      // Message must precede -f, which is variadic and would swallow it.
      args: [
        'run',
        'Follow the instructions in the attached file exactly. Your final message is the answer.',
        '--agent',
        'plan',
        ...(opt.model ? ['-m', opt.model] : []),
        '-f',
        promptFile,
      ],
      stdin: '',
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
