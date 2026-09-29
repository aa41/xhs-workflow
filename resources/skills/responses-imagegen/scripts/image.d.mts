export function pngDimensions(bytes: Buffer): { width: number; height: number; colorType: number };
export function generateImage(options: { prompt: string; inputs?: string[]; mask?: string; out: string; previousResponseId?: string;
  env?: Record<string, string | undefined>; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<{
  path: string; responseId: string | null; revisedPrompt: string | null; mimeType: string }>;
