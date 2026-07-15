export function formatProjectName(name: string, nameHidden?: boolean): string {
  return nameHidden ? name.replace(/\S/gu, "*") : name;
}
