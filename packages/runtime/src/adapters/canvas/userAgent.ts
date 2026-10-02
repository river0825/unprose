// The User-Agent the runtime's canvas adapters send: `unprose/<version> (<component>)`, like every Unprose client
// (Cloudflare in front of a tunnel refuses requests without one). The `awd` CLI sets UNPROSE_VERSION.
export function canvasUserAgent(component: string, env: NodeJS.ProcessEnv = process.env): string {
  return `unprose${env.UNPROSE_VERSION ? `/${env.UNPROSE_VERSION}` : ''} (${component})`
}
