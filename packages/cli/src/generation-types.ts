import type {
  ResolvedProject,
  UpstreamScaffoldPlan,
  VirtualFileSystem,
} from "@nordix-tech/nordixgen-core";
/** Prepared direct-renderer output only; the CLI owns execution effects. */
export interface PreparedApplication {
  readonly name: string;
  readonly path: string;
  readonly backend: boolean;
  readonly database: boolean;
  readonly globalAuthorization?: boolean;
  readonly repository: ResolvedProject["repositories"][number];
  readonly files: VirtualFileSystem;
  readonly scaffold: UpstreamScaffoldPlan;
  readonly runtime: Readonly<Record<string, string>>;
  readonly development: Readonly<Record<string, string>>;
}
