import { existsSync, readFileSync } from 'node:fs';

// Commit messages describe the change and nothing else: no emoji, and none of the phrases a
// contributor refuses (trailers, tool names), listed one per line in the untracked
// .local/forbidden-words.
const LOCAL_WORDS = '.local/forbidden-words';
const localWords = existsSync(LOCAL_WORDS)
  ? readFileSync(LOCAL_WORDS, 'utf8')
      .split(/\r?\n/)
      .map((word) => word.trim())
      .filter(Boolean)
  : [];
const FORBIDDEN = localWords.length > 0 ? new RegExp(localWords.join('|'), 'i') : null;
const EMOJI = /\p{Extended_Pictographic}/u;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-attribution': ({ raw }) => [
          !FORBIDDEN?.test(raw ?? ''),
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
