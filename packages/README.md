# Workspace packages

The pnpm workspace currently contains two packages:

- [`@nordixgen/core`](core/README.md): YAML parsing, structural and semantic validation, project normalization, generator composition, and virtual file output. Its generic plugin/composition contracts are part of the legacy implementation being simplified in the v1.1.0 refactor; they are not a supported third-party extension API.
- [`@nordixgen/cli`](cli): command-line entry point and project-generation orchestration (`init`, `validate`, and `generate`).

NordixGen targets a fixed stack for Nordix client projects. The intended backend is a modular monolith with architecture chosen per business module. See the [product requirements](../docs/SPECIFICATION.md) and the [v1.1.0 refactor milestone](https://github.com/NordixTech/NordixGen/milestone/2).
