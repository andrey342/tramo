// Commit messages describe the change and nothing else: no tool attribution, trailers or emoji.
const FORBIDDEN = /co-authored-by|anthropic|generated with|ai-generated|claude/i;
const EMOJI = /\p{Extended_Pictographic}/u;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-attribution': ({ raw }) => [
          !FORBIDDEN.test(raw ?? ''),
          'commit message must not contain attribution trailers or tool names',
        ],
        'no-emoji': ({ raw }) => [!EMOJI.test(raw ?? ''), 'commit message must not contain emoji'],
      },
    },
  ],
  rules: {
    'no-attribution': [2, 'always'],
    'no-emoji': [2, 'always'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
