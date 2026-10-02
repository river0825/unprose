// Port: AccessStore — where the canvas keeps the agents allowed in from elsewhere (docs/canvas.md "Remote
// agents"): access tokens, OAuth clients, browser sessions. Secrets are never stored, only their sha-256.
// Adapters: a 0600 JSON file under the server's data dir (~/.awd/agents.json), and memory (tests).

export interface AgentRecord {
  /** `ag_<random>`; stable for the life of the record. */
  id: string
  /** Shown everywhere (change feed, presence, the agents page). Unique among records that are not revoked. */
  name: string
  /** How it got in: a token made in the page, an OAuth client approved on connect, an agent without a browser (device code), a browser let in. */
  via: 'token' | 'oauth' | 'device' | 'browser'
  scope: 'read' | 'write'
  projects?: string[]
  boards?: string[]
  /** sha-256 (hex) of the current access token / session secret. */
  tokenHash: string
  /** OAuth: when the access token expires (ISO); static tokens and sessions do not. */
  expiresAt?: string
  /** OAuth: sha-256 of the current refresh token (rotated on every use). */
  refreshHash?: string
  /** OAuth: the registered client it was issued to. */
  clientId?: string
  createdAt: string
  /** Who approved or created it: 'this machine', or the name of the signed-in browser that typed the pairing code. */
  createdBy: string
  /** A browser session that may also create / revoke tokens (granted only by a page on this machine). */
  manage?: boolean
  lastUsedAt?: string
  lastIp?: string
  lastUserAgent?: string
  revokedAt?: string
}

export interface OAuthClientRecord {
  clientId: string
  name: string
  redirectUris: string[]
  createdAt: string
}

export interface AccessData {
  agents: AgentRecord[]
  clients: OAuthClientRecord[]
}

export interface AccessStore {
  read(): AccessData
  write(data: AccessData): void
  /** Where it is kept, for messages ('memory' for the memory adapter). */
  readonly where: string
}
