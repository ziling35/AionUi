const IMAGE_CREATION_PATTERNS = [
  /\bgenerate(?:\s+an?)?\s+image\b/i,
  /\bcreate(?:\s+an?)?\s+image\b/i,
  /\bmake(?:\s+an?)?\s+image\b/i,
  /\bdraw\b/i,
  /\bpaint\b/i,
  /\btext[-\s]?to[-\s]?image\b/i,
  /生成.*图|生图|画一?张|绘制/u,
];

const IMAGE_EDIT_PATTERNS = [
  /\bedit(?:\s+the)?\s+image\b/i,
  /\bmodify(?:\s+the)?\s+image\b/i,
  /\bchange(?:\s+the)?\s+image\b/i,
  /\bimage[-\s]?to[-\s]?image\b/i,
  /\binpaint\b/i,
  /\boutpaint\b/i,
  /\bremove background\b/i,
  /\bupscale\b/i,
  /图生图|改图|编辑图片|修改图片|重绘|去背景|抠图/u,
];

const IMAGE_ANALYSIS_PATTERNS = [
  /\banaly[sz]e(?:\s+the)?\s+image\b/i,
  /\bdescribe(?:\s+the)?\s+image\b/i,
  /\bread(?:\s+the)?\s+screenshot\b/i,
  /\binspect(?:\s+the)?\s+screenshot\b/i,
  /\blook at(?:\s+the)?\s+screenshot\b/i,
  /\bscreenshot\b/i,
  /截图|看图|识图|读图|分析图片|分析一下图片|看一下.*图|报错图|页面卡住|配置截图/u,
];

export type ImageGenerationToolPolicyResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'image-analysis-not-supported';
      message: string;
    };

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function isImageGenerationOrEditPrompt(prompt: string): boolean {
  return matchesAny(prompt, IMAGE_CREATION_PATTERNS) || matchesAny(prompt, IMAGE_EDIT_PATTERNS);
}

export function validateImageGenerationToolRequest(prompt: string): ImageGenerationToolPolicyResult {
  const normalizedPrompt = prompt.trim();
  const wantsGenerationOrEdit = isImageGenerationOrEditPrompt(normalizedPrompt);
  if (wantsGenerationOrEdit) {
    return { allowed: true };
  }

  const looksLikeImageAnalysis = matchesAny(normalizedPrompt, IMAGE_ANALYSIS_PATTERNS);
  if (!looksLikeImageAnalysis) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'image-analysis-not-supported',
    message:
      'This tool is only for image generation or image editing. Do not use it to inspect, read, or analyze screenshots. Use the chat model vision input if available, or ask the user to provide the relevant text/configuration.',
  };
}
