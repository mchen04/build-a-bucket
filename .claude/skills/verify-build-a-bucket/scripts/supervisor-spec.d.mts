export function buildSupervisorSpec(options: {
  mode: string;
  port: number;
  dir: string;
  repo: string;
  prepared: { pgPort: number; database: string } | null;
}): {
  postgresInit: { root: string; port: number; database: string; schema: string } | null;
  services: unknown[];
};
