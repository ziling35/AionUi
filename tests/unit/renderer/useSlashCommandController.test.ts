import { describe, expect, it } from 'vitest';
import type { SlashCommandItem } from '@/common/chat/slash/types';
import {
  filterSlashCommands,
  rankSlashCommandMatch,
  shouldOpenSlashCommandMenu,
} from '@/renderer/hooks/chat/useSlashCommandController';

const command = (name: string, description: string): SlashCommandItem => ({
  name,
  description,
  kind: 'template',
  source: 'acp',
});

describe('slash command search', () => {
  it('ranks exact, prefix, substring, then description matches', () => {
    const commands = [
      command('prectx-post', 'Command name contains ctx'),
      command('ctx-summary', 'Summarize context'),
      command('ctx', 'Exact context shortcut'),
      command('plan', 'Create an implementation ctx checklist'),
    ];

    expect(filterSlashCommands(commands, 'ctx').map((item) => item.name)).toEqual([
      'ctx',
      'ctx-summary',
      'prectx-post',
      'plan',
    ]);
  });

  it('returns all commands in original order for an empty query', () => {
    const commands = [command('review', 'Review diff'), command('plan', 'Create plan')];

    expect(filterSlashCommands(commands, '').map((item) => item.name)).toEqual(['review', 'plan']);
  });

  it('returns null for non-matches', () => {
    expect(rankSlashCommandMatch(command('review', 'Review diff'), 'deploy')).toBeNull();
  });

  it('keeps the menu open for empty search results when commands exist', () => {
    expect(shouldOpenSlashCommandMenu('deploy', false, 2)).toBe(true);
    expect(shouldOpenSlashCommandMenu('deploy', true, 2)).toBe(false);
    expect(shouldOpenSlashCommandMenu('deploy', false, 0)).toBe(false);
    expect(shouldOpenSlashCommandMenu(null, false, 2)).toBe(false);
  });
});
