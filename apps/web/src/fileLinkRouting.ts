export function relativePathWithinWorkspace(
  absolutePath: string,
  workspaceCwd: string,
): string | null {
  const prefix = workspaceCwd.endsWith("/") ? workspaceCwd : `${workspaceCwd}/`;
  if (!absolutePath.startsWith(prefix)) {
    return null;
  }

  return absolutePath.slice(prefix.length);
}
