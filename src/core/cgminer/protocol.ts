export function buildRequest(command: string, parameter?: string): string {
  return parameter === undefined
    ? JSON.stringify({ command })
    : JSON.stringify({ command, parameter });
}

export function cleanRawResponse(raw: string): string {
  return raw
    .replace(/ +$/g, "") // trailing NUL bytes / padding spaces
    .trim()
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas some firmwares emit
}
