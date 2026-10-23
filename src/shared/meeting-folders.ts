export interface MeetingFolderAgent {
  name: string;
  cwd?: string;
}

export function normalizeMeetingFolder(cwd: string): string {
  const slashed = cwd.trim().replace(/\//g, '\\');
  const withoutTrailingSeparators = slashed.replace(/\\+$/, '');
  const isDriveRoot = /^[a-z]:$/i.test(withoutTrailingSeparators) && /\\$/.test(slashed);
  return `${withoutTrailingSeparators}${isDriveRoot ? '\\' : ''}`.toLocaleLowerCase('en-US');
}

export function meetingFoldersDiffer(agents: MeetingFolderAgent[]): boolean {
  const folders = agents.map(agent => agent.cwd?.trim()).filter((cwd): cwd is string => Boolean(cwd));
  return folders.length > 1 && new Set(folders.map(normalizeMeetingFolder)).size > 1;
}
