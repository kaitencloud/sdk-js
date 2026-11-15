# Security Policy

Please do not report security vulnerabilities through public GitHub issues.

Report them privately, through either channel:

- GitHub Private Vulnerability Reporting for this repository, from its
  **Security** tab, when available;
- email to [security@kaiten.sh](mailto:security@kaiten.sh), which also suits
  reporters without a GitHub account.

Include, where possible:

- affected version or commit;
- vulnerability description;
- reproduction steps or proof of concept;
- expected impact;
- known mitigations.

KAITEN INC asks reporters to allow reasonable time to investigate and address
a vulnerability before public disclosure.

## Reports about these packages

Name the affected package, `@kaitencloud/client`, `@kaitencloud/server`,
`@kaitencloud/react` or `@kaitencloud/react-ui`, and its version.

Never include a real credential. Replace it with a placeholder: its prefix (`ksh_`,
`whsec_`, …) is enough to say which kind it was.

## Supported versions

The latest release of each package. Fixes ship in a new release rather than as
backports to older versions.

## Leaked credentials

A credential that reached a browser bundle, a repository or a log is compromised
whatever these packages do. Rotate it from the Kaiten console.
