export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_BATCH_FILES = 20;
export function sourceFileError(file: {
  name: string;
  size: number;
}): string | null {
  const hasControlCharacter = Array.from(file.name).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!file.name || file.name.length > 180 || hasControlCharacter)
    return "Use a filename with 1–180 characters and no control characters.";
  if (!/\.(md|txt|pdf)$/i.test(file.name))
    return "Choose Markdown, text, or a text-based PDF.";
  if (!file.size || file.size > MAX_SOURCE_BYTES)
    return "Files must be nonempty and 8 MiB or smaller.";
  return null;
}
