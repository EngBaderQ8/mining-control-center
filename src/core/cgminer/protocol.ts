export function buildRequest(command: string, parameter?: string): string {
  return parameter === undefined
    ? JSON.stringify({ command })
    : JSON.stringify({ command, parameter });
}

export function cleanRawResponse(raw: string): string {
  return raw
    .replace(/\0/g, "") // remove NUL terminators/padding (trim() does NOT strip these)
    .replace(/[\x00-\x1f]+$/g, "") // drop any other trailing control bytes
    .trim()
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas some firmwares emit
}
