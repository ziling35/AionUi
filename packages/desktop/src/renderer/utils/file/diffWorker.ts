import { createTwoFilesPatch } from 'diff';
import { parseDiff } from './diffUtils';

self.onmessage = (e: MessageEvent) => {
  try {
    const { id, old_text, new_text, path } = e.data;
    const display_name = path.split(/[/\\]/).pop() || path || 'Unknown file';
    
    // Generate diff
    const formattedDiff = createTwoFilesPatch(display_name, display_name, old_text, new_text, '', '', { context: 3 });
    
    // Parse diff to get insertions and deletions
    const fileInfo = parseDiff(formattedDiff, display_name);
    
    self.postMessage({ id, formattedDiff, fileInfo });
  } catch (error) {
    self.postMessage({ id: e.data?.id, error: error instanceof Error ? error.message : String(error) });
  }
};
