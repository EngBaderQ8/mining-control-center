// Ed25519 PUBLIC key used to verify server-hosted update manifests. The matching
// PRIVATE key lives ONLY on the server (env UPDATE_PRIVATE_KEY) and signs each
// uploaded update. The client refuses any update whose manifest signature doesn't
// verify against this key — so even over the self-signed connection, no one can
// push a forged update without the private key.
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAZOCfehSHbt9j4LY+byCd5ZiaMZqFtsIsAQkj3g62i24=
-----END PUBLIC KEY-----`;
