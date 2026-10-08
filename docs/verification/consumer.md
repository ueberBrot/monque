# Consumer upgrade verification

Run `vp run verify:consumer` from the repository root with Docker running. Install the
repository's pinned dependencies first with `vp install --frozen-lockfile`. The check
needs registry access for the consumer's dependencies and Docker access for MongoDB.

The command builds all published packages, packs them with Bun, and installs them in
temporary applications outside the workspace. Each application runs under Node.js.
It uses a disposable MongoDB 8 replica set and removes its container and temporary
files when the check finishes. It never connects to an application database.

The compatibility cases are:

- Core 1.16.0 from the registry with packed Management and Express adapters. This is
  the first published Core version satisfying the `^1.15.1` peer range. Version
  1.15.1 was never published. Reads work, and the priority action reports that it is
  unavailable and rejects requests with HTTP 403.
- Management 0.8.0 from the registry with packed Core and adapters. Reads work, and
  capabilities do not advertise priority changes.
- All current packed packages, including the Ts.ED integration. Priority changes
  work through the HTTP API and through the Ts.ED service after module initialization.

The first case leaves an older collection for the current packages to upgrade. The
fixture includes pending and terminal Jobs and an owned processing Job. Initialization
must add the default priority without changing any other Job fields or existing indexes.
It must add the priority index, and repeating initialization must leave the Jobs unchanged.
A separate collection checks that `skipIndexCreation` preserves managed indexes while
still filling in missing priorities.

Every case loads the ESM and CommonJS entrypoints. HTTP checks cover authentication
on the API, OpenAPI, and Dashboard; nested Dashboard paths; injected configuration;
and the entry assets in the package. These checks do not drive a browser. The repository's
`vp run test:all` command covers browser workflows for the current package combination.
Serving the current Dashboard's assets beside older packages does not establish browser
compatibility with those packages.

Successful runs write `.verification/consumer.json` with the installed Monque versions
and completed checks. The file is ignored by Git and cleared at the start of each run,
so a failed run cannot leave an earlier success at that path. Dependency resolution
uses the registry at run time; transitive dependencies can change between runs.

To repeat the check after a completed package build, run:

```sh
node scripts/verification/consumer.mjs --skip-build
```

The fixture pins Express 5.2.1, MongoDB driver 7.7.0, and Ts.ED 8.41.2. It checks
representative supported combinations, not every version allowed by the peer ranges.
Run it under each supported Node.js version when validating a runtime upgrade.
